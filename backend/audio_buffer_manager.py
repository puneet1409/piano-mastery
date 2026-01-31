"""
Sliding window buffer manager for continuous audio streaming to an ML model.

Manages a growing audio buffer and produces overlapping windows suitable for
real-time note detection. Includes both legacy deduplication and a consensus
merge system that uses evidence from multiple overlapping windows.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from onsets_frames_tflite import NoteEvent


@dataclass
class PendingNote:
    """A note accumulating evidence across overlapping windows."""
    pitch: int
    note: str
    onset: float       # absolute time (seconds)
    offset: float      # absolute time (seconds)
    velocity: float
    confidence: float
    onset_strength: float
    seen: int           # number of windows this note was detected in
    last_window_idx: int


class AudioBufferManager:
    """
    Accumulates incoming audio chunks and yields fixed-size windows
    with configurable hop (overlap) for continuous ML inference.

    Parameters
    ----------
    sample_rate : int
        Sample rate of the incoming audio (default 44100 Hz).
    window_samples : int
        Number of samples per analysis window. Default 49392 corresponds to
        the ML model's 17920 samples @ 16 kHz scaled to 44.1 kHz (~1.12 s).
    hop_ratio : float
        Fraction of window_samples to advance between consecutive windows
        after the first full window (0.5 = 50 % overlap).
    dedup_window_ms : float
        Time window in milliseconds for suppressing duplicate note detections
        of the same pitch across overlapping windows.
    """

    def __init__(
        self,
        sample_rate: int = 44100,
        window_samples: int = 49392,
        hop_ratio: float = 0.50,
        dedup_window_ms: float = 500.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.window_samples = window_samples
        self.hop_ratio = hop_ratio
        self.dedup_window_ms = dedup_window_ms

        self._hop_samples = int(window_samples * hop_ratio)

        # Internal buffer – a 1-D numpy array that grows as chunks arrive.
        self._buffer: np.ndarray = np.array([], dtype=np.float32)

        # Read cursor: the sample index where the next window starts.
        self._read_pos: int = 0

        # Whether we have already emitted the first (full) window.
        self._first_window_emitted: bool = False

        # Track where the last emitted window starts (absolute sample index).
        self._last_window_start: int = 0

        # Cumulative sample offset from buffer compactions, so that
        # absolute positions remain correct after trimming the buffer.
        self._compacted_offset: int = 0

        # Recently detected notes kept for deduplication.
        self._recent_notes: List[NoteEvent] = []

        # ── Consensus merge state ──
        self._window_idx: int = 0
        self._pending: Dict[int, List[PendingNote]] = {}  # pitch -> pending notes
        self._window_size_s = window_samples / sample_rate
        self._onset_tol = 0.12  # 120ms match window for same-note across windows

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_chunk(self, chunk: np.ndarray) -> Optional[np.ndarray]:
        """
        Append *chunk* to the internal buffer.

        Returns
        -------
        np.ndarray or None
            A window of ``window_samples`` samples when enough data has been
            accumulated, otherwise ``None``.

        After the first window is emitted the read cursor advances by
        ``hop_ratio * window_samples`` so that subsequent windows overlap.
        """
        # Ensure float32 mono
        chunk = np.asarray(chunk, dtype=np.float32).ravel()
        self._buffer = np.concatenate([self._buffer, chunk])

        available = len(self._buffer) - self._read_pos
        if available < self.window_samples:
            return None

        # Extract the window and record its absolute start position
        self._last_window_start = self._compacted_offset + self._read_pos
        window = self._buffer[self._read_pos : self._read_pos + self.window_samples].copy()

        # Advance the read cursor
        if not self._first_window_emitted:
            # First window: advance by the full window so the next emission
            # will start hop_samples before the end of this window.
            self._read_pos += self.window_samples
            self._first_window_emitted = True
        else:
            self._read_pos += self._hop_samples

        # Compact the buffer when the consumed portion grows large to
        # avoid unbounded memory growth.
        if self._read_pos > self.window_samples * 4:
            self._compacted_offset += self._read_pos
            self._buffer = self._buffer[self._read_pos :]
            self._read_pos = 0

        return window

    def deduplicate_notes(
        self, new_notes: List[NoteEvent], window_offset_s: float
    ) -> List[NoteEvent]:
        """
        Filter out duplicate note detections across overlapping windows.

        Parameters
        ----------
        new_notes : list[NoteEvent]
            Notes detected in the current analysis window (times relative
            to the start of that window).
        window_offset_s : float
            Absolute time offset (in seconds) of the current window's start
            within the overall audio stream.

        Returns
        -------
        list[NoteEvent]
            Notes with adjusted ``onset_time`` / ``offset_time`` and
            duplicates (same pitch within ``dedup_window_ms``) removed.
        """
        dedup_s = self.dedup_window_ms / 1000.0
        unique: List[NoteEvent] = []

        for note in new_notes:
            # Shift times to the absolute stream timeline
            adjusted = NoteEvent(
                note=note.note,
                pitch=note.pitch,
                onset_time=note.onset_time + window_offset_s,
                offset_time=note.offset_time + window_offset_s,
                velocity=note.velocity,
                confidence=note.confidence,
            )

            # Check against recent notes for the same pitch
            is_dup = False
            for recent in self._recent_notes:
                if recent.pitch != adjusted.pitch:
                    continue
                # Standard onset-proximity dedup
                if abs(adjusted.onset_time - recent.onset_time) <= dedup_s:
                    is_dup = True
                    break
                # Duration-aware dedup: if the recent note is still sounding
                # when the new detection starts, it's a re-detection of the
                # same sustained note across overlapping windows.
                if recent.offset_time >= adjusted.onset_time:
                    is_dup = True
                    break

            if not is_dup:
                unique.append(adjusted)

        # Prune stale entries from the recent-notes list and add new ones.
        # Use a retention window larger than the dedup window to avoid
        # premature pruning that allows duplicates through.  The hop between
        # overlapping windows is ~0.56 s, so a note must survive at least
        # 2-3 hops after its first detection.
        retention_s = dedup_s * 4
        if unique:
            latest_time = max(n.onset_time for n in unique)
            self._recent_notes = [
                n
                for n in self._recent_notes
                if latest_time - n.onset_time <= retention_s
            ]
            self._recent_notes.extend(unique)
        elif new_notes:
            # Even when all notes are duplicates, still prune based on the
            # latest incoming onset so the list does not grow unbounded.
            latest_incoming = max(
                n.onset_time + window_offset_s for n in new_notes
            )
            self._recent_notes = [
                n
                for n in self._recent_notes
                if latest_incoming - n.onset_time <= retention_s
            ]

        return unique

    # ------------------------------------------------------------------
    # Consensus merge API (replaces deduplicate_notes for better recall)
    # ------------------------------------------------------------------

    def consensus_notes(
        self, new_notes: List[NoteEvent], window_offset_s: float
    ) -> List[NoteEvent]:
        """
        Merge note detections across overlapping windows.

        Like ``deduplicate_notes`` but instead of discarding duplicates,
        merges them to produce improved onset timing and confidence.
        Emits each note on first detection (no confirmation delay) but
        suppresses re-detections using the same duration-aware logic.

        Parameters
        ----------
        new_notes : list[NoteEvent]
            Notes from the current window (times relative to window start).
        window_offset_s : float
            Absolute time of the current window's start.

        Returns
        -------
        list[NoteEvent]
            New notes with absolute times (re-detections merged silently).
        """
        dedup_s = self.dedup_window_ms / 1000.0
        unique: List[NoteEvent] = []

        for note in new_notes:
            abs_onset = note.onset_time + window_offset_s
            abs_offset = note.offset_time + window_offset_s

            adjusted = NoteEvent(
                note=note.note,
                pitch=note.pitch,
                onset_time=abs_onset,
                offset_time=abs_offset,
                velocity=note.velocity,
                confidence=note.confidence,
                onset_strength=note.onset_strength,
            )

            # Check against recent notes for the same pitch
            merged = False
            for recent in self._recent_notes:
                if recent.pitch != adjusted.pitch:
                    continue
                # Onset-proximity match
                if abs(adjusted.onset_time - recent.onset_time) <= dedup_s:
                    # Merge: improve confidence/velocity but do NOT extend
                    # offset — that would create shadow zones that suppress
                    # later genuine onsets of the same pitch.
                    recent.confidence = max(recent.confidence, adjusted.confidence)
                    recent.onset_strength = max(recent.onset_strength, adjusted.onset_strength)
                    recent.velocity = max(recent.velocity, adjusted.velocity)
                    merged = True
                    break
                # Duration-aware: sustained note re-detection
                if recent.offset_time >= adjusted.onset_time:
                    merged = True
                    break

            if not merged:
                unique.append(adjusted)

        # Prune stale entries and add new ones
        retention_s = dedup_s * 4
        if unique:
            latest_time = max(n.onset_time for n in unique)
            self._recent_notes = [
                n for n in self._recent_notes
                if latest_time - n.onset_time <= retention_s
            ]
            self._recent_notes.extend(unique)
        elif new_notes:
            latest_incoming = max(
                n.onset_time + window_offset_s for n in new_notes
            )
            self._recent_notes = [
                n for n in self._recent_notes
                if latest_incoming - n.onset_time <= retention_s
            ]

        return unique

    def flush_pending(self) -> List[NoteEvent]:
        """
        Emit all remaining pending notes at end of audio.

        With the merge-based consensus, notes are emitted immediately,
        so this only clears the pending buffer (kept for API compat).
        """
        self._pending.clear()
        return []

    @staticmethod
    def _pending_to_note(p: PendingNote) -> NoteEvent:
        """Convert a PendingNote to a NoteEvent with absolute times."""
        return NoteEvent(
            note=p.note,
            pitch=p.pitch,
            onset_time=p.onset,
            offset_time=p.offset,
            velocity=p.velocity,
            confidence=p.confidence,
            onset_strength=p.onset_strength,
        )

    def flush(self) -> Optional[np.ndarray]:
        """
        Return a zero-padded final window from any remaining audio in
        the buffer that hasn't been emitted yet.

        Useful at the end of a recording to process notes that fall
        near the tail of the audio and didn't fill a complete window.

        Returns
        -------
        np.ndarray or None
            A padded window if enough data remains (>= 25 % of
            ``window_samples``), otherwise ``None``.
        """
        remaining = len(self._buffer) - self._read_pos
        if remaining <= 0 or remaining < self.window_samples * 0.25:
            return None

        self._last_window_start = self._compacted_offset + self._read_pos
        if remaining >= self.window_samples:
            # Enough data for a full window — take the last window_samples
            window = self._buffer[self._read_pos : self._read_pos + self.window_samples].copy()
        else:
            # Partial window — pad with zeros
            segment = self._buffer[self._read_pos : self._read_pos + remaining].copy()
            window = np.pad(segment, (0, self.window_samples - remaining), mode="constant")
        self._read_pos = len(self._buffer)
        return window

    def reset(self) -> None:
        """Clear all internal state between sessions."""
        self._buffer = np.array([], dtype=np.float32)
        self._read_pos = 0
        self._first_window_emitted = False
        self._last_window_start = 0
        self._compacted_offset = 0
        self._recent_notes.clear()
        self._window_idx = 0
        self._pending.clear()

    @property
    def current_offset_s(self) -> float:
        """Return the current read-cursor position in seconds."""
        return (self._compacted_offset + self._read_pos) / self.sample_rate

    @property
    def last_window_start_s(self) -> float:
        """Return the absolute start time (seconds) of the last emitted window."""
        return self._last_window_start / self.sample_rate
