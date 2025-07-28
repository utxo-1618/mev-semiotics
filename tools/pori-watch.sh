#!/bin/bash
# Watch PoRI stats - updates every 5 seconds

while true; do
    clear
    date +"%Y-%m-%d %H:%M:%S"
    echo "---"
    node pori-stats.js
    sleep 5
done
