#!/bin/bash
# Download PIANO INSTRUMENTAL versions (no vocals)

export PATH="$PATH:/c/Users/punee/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0/LocalCache/local-packages/Python312/Scripts"
cd "$(dirname "$0")/test-audio"

download() {
    local search="$1"
    local name="$2"

    if [ -f "${name}.wav" ]; then
        echo "SKIP: ${name}.wav exists"
        return
    fi

    echo ">>> Downloading: $name"
    yt-dlp -x --audio-format wav --audio-quality 0 \
        --output "${name}.%(ext)s" \
        --no-playlist --max-downloads 1 \
        --match-filter "duration < 420" \
        "$search" 2>/dev/null

    if [ -f "${name}.wav" ]; then
        echo "OK: ${name}.wav"
    else
        echo "FAIL: $name"
    fi
}

echo "=== Bollywood Piano Instrumentals ==="
download "ytsearch1:Tum Hi Ho piano instrumental no vocals" "tum_hi_ho"
download "ytsearch1:Kal Ho Na Ho piano solo instrumental" "kal_ho_na_ho"
download "ytsearch1:Channa Mereya piano instrumental only" "channa_mereya"
download "ytsearch1:Kabira piano instrumental no singing" "kabira"
download "ytsearch1:Agar Tum Saath Ho piano solo" "agar_tum_saath_ho"
download "ytsearch1:Pehla Nasha piano instrumental cover" "pehla_nasha"
download "ytsearch1:Tujhe Dekha To DDLJ piano solo" "tujhe_dekha_to"
download "ytsearch1:Tera Ban Jaunga piano instrumental" "tera_ban_jaunga"

echo ""
echo "=== Pop Piano Instrumentals ==="
download "ytsearch1:All of Me John Legend piano instrumental karaoke" "all_of_me"
download "ytsearch1:Someone Like You Adele piano only instrumental" "someone_like_you"
download "ytsearch1:A Thousand Years piano instrumental no vocals" "a_thousand_years"
download "ytsearch1:Let Her Go Passenger piano instrumental" "let_her_go"
download "ytsearch1:Perfect Ed Sheeran piano instrumental only" "perfect"
download "ytsearch1:Shallow Lady Gaga piano solo instrumental" "shallow"
download "ytsearch1:Hallelujah Leonard Cohen piano only" "hallelujah"

echo ""
echo "=== Complete ==="
ls *.wav 2>/dev/null | wc -l
