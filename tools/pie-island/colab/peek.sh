#!/usr/bin/env bash
# usage: peek.sh <session> <remote-file> [lines]   (file API is more reliable than exec while a VM is busy)
t=$(mktemp); colab download -s "$1" "$2" "$t" >/dev/null 2>&1 && tail -n "${3:-8}" "$t" | cut -c1-240; rm -f "$t"
