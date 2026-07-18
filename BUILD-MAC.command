#!/usr/bin/env bash
cd "$(dirname "$0")"
./build-macos.sh
STATUS=$?
echo
if [[ $STATUS -eq 0 ]]; then
  echo "BUILD COMPLETED. Installers are in installers/macos."
else
  echo "BUILD FAILED. Review the error above."
fi
read -r -p "Press Enter to close..."
exit $STATUS
