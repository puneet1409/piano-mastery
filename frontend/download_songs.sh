#!/bin/bash
# Download Bollywood and Pop piano covers for testing

export PATH="$PATH:/c/Users/punee/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0/LocalCache/local-packages/Python312/Scripts"

cd "$(dirname "$0")/test-audio"

# Function to download and convert to WAV
download_song() {
    local url="$1"
    local name="$2"

    if [ -f "${name}.wav" ]; then
        echo "SKIP: ${name}.wav already exists"
        return
    fi

    echo "Downloading: $name"
    yt-dlp -x --audio-format wav --audio-quality 0 \
        --output "${name}.%(ext)s" \
        --no-playlist \
        --max-downloads 1 \
        "$url" 2>/dev/null

    if [ -f "${name}.wav" ]; then
        echo "SUCCESS: ${name}.wav"
    else
        echo "FAILED: $name"
    fi
}

echo "=== Downloading Bollywood Piano Covers ==="

# Bollywood songs (searching for piano covers)
download_song "ytsearch1:Tum Hi Ho piano cover" "tum_hi_ho"
download_song "ytsearch1:Kal Ho Na Ho piano cover instrumental" "kal_ho_na_ho"
download_song "ytsearch1:Channa Mereya piano cover" "channa_mereya"
download_song "ytsearch1:Kabira piano cover instrumental" "kabira"
download_song "ytsearch1:Agar Tum Saath Ho piano cover" "agar_tum_saath_ho"
download_song "ytsearch1:Pehla Nasha piano cover" "pehla_nasha"
download_song "ytsearch1:Tujhe Dekha To piano cover DDLJ" "tujhe_dekha_to"
download_song "ytsearch1:Tera Ban Jaunga piano cover" "tera_ban_jaunga"

echo ""
echo "=== Downloading Pop Piano Covers ==="

# Pop/Western songs
download_song "ytsearch1:All of Me John Legend piano cover" "all_of_me"
download_song "ytsearch1:Someone Like You Adele piano cover" "someone_like_you"
download_song "ytsearch1:A Thousand Years piano cover instrumental" "a_thousand_years"
download_song "ytsearch1:Let Her Go Passenger piano cover" "let_her_go"
download_song "ytsearch1:Perfect Ed Sheeran piano cover" "perfect"
download_song "ytsearch1:Shallow Lady Gaga piano cover" "shallow"
download_song "ytsearch1:Hallelujah piano cover instrumental" "hallelujah"

echo ""
echo "=== Download Complete ==="
ls -la *.wav | wc -l
echo "WAV files available"
