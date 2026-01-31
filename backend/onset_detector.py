"""
Spectral flux onset detector for immediate piano feedback (<20ms latency).

Uses positive spectral flux with adaptive thresholding and energy gating
to detect note onsets in real-time audio chunks.
"""

from dataclasses import dataclass
from typing import Optional
from collections import deque

import numpy as np


@dataclass
class OnsetEvent:
    """Represents a detected note onset."""
    timestamp: float
    strength: float
    register: str  # "bass", "mid", or "treble"


class OnsetDetector:
    """
    Real-time onset detector using positive spectral flux.

    Processes audio chunks and detects onsets by measuring the increase
    in spectral energy between consecutive frames. An adaptive threshold
    (running mean + 2*std over recent flux values) prevents false triggers.
    An energy gate filters out room noise below a configurable RMS threshold.

    Args:
        sample_rate: Audio sample rate in Hz.
        fft_size: FFT window size in samples.
        energy_threshold: Minimum RMS energy to consider a chunk (noise gate).
    """

    def __init__(
        self,
        sample_rate: int = 44100,
        fft_size: int = 2048,
        energy_threshold: float = 0.01,
    ) -> None:
        self.sample_rate = sample_rate
        self.fft_size = fft_size
        self.energy_threshold = energy_threshold

        # Number of positive-frequency bins (DC through Nyquist)
        self._num_bins = fft_size // 2 + 1

        # Frequency array for spectral centroid calculation
        self._freqs = np.linspace(0, sample_rate / 2, self._num_bins)

        # Hann window for smoother spectral analysis
        self._window = np.hanning(fft_size)

        # Internal state
        self._prev_spectrum: Optional[np.ndarray] = None
        self._flux_history: deque[float] = deque(maxlen=10)
        self._samples_processed: int = 0

    def process_chunk(self, audio_chunk: np.ndarray) -> Optional[OnsetEvent]:
        """
        Process a single audio chunk and detect if an onset occurred.

        Args:
            audio_chunk: 1-D array of audio samples. If longer than fft_size,
                only the last fft_size samples are used. If shorter, the chunk
                is zero-padded on the left.

        Returns:
            An OnsetEvent if an onset is detected, otherwise None.
        """
        # Prepare the frame: ensure it is exactly fft_size samples
        chunk = np.asarray(audio_chunk, dtype=np.float64).ravel()

        if len(chunk) >= self.fft_size:
            frame = chunk[-self.fft_size:]
        else:
            frame = np.zeros(self.fft_size, dtype=np.float64)
            frame[-len(chunk):] = chunk

        # Energy gate: reject chunks below RMS threshold (room noise)
        rms = np.sqrt(np.mean(frame ** 2))
        if rms < self.energy_threshold:
            self._samples_processed += len(chunk)
            return None

        # Apply window and compute magnitude spectrum
        windowed = frame * self._window
        spectrum = np.abs(np.fft.rfft(windowed))

        # Compute positive spectral flux
        if self._prev_spectrum is not None:
            diff = spectrum - self._prev_spectrum
            flux = float(np.sum(np.maximum(diff, 0.0)))
        else:
            # First frame: no previous spectrum to compare against
            flux = 0.0

        self._prev_spectrum = spectrum

        # Update flux history and compute adaptive threshold
        self._flux_history.append(flux)

        # Calculate timestamp for this chunk
        timestamp = self._samples_processed / self.sample_rate
        self._samples_processed += len(chunk)

        # Need at least 2 flux values to compute a meaningful threshold
        if len(self._flux_history) < 2:
            return None

        history = np.array(self._flux_history)
        mean_flux = float(np.mean(history))
        std_flux = float(np.std(history))
        threshold = mean_flux + 2.0 * std_flux

        # Check if current flux exceeds adaptive threshold
        if flux <= threshold or flux == 0.0:
            return None

        # Estimate register from spectral centroid
        register = self._estimate_register(spectrum)

        return OnsetEvent(
            timestamp=timestamp,
            strength=flux,
            register=register,
        )

    def _estimate_register(self, spectrum: np.ndarray) -> str:
        """
        Estimate the rough pitch register from the spectral centroid.

        Returns:
            "bass" if centroid < 250 Hz,
            "mid" if centroid 250-1000 Hz,
            "treble" if centroid > 1000 Hz.
        """
        total_energy = np.sum(spectrum)
        if total_energy == 0.0:
            return "mid"

        centroid = float(np.sum(self._freqs * spectrum) / total_energy)

        if centroid < 250.0:
            return "bass"
        elif centroid <= 1000.0:
            return "mid"
        else:
            return "treble"

    def reset(self) -> None:
        """Clear all internal state between sessions."""
        self._prev_spectrum = None
        self._flux_history.clear()
        self._samples_processed = 0
