#!/bin/zsh

set -e

#
#
# Don't forget to conda activate localnotes before starting
#
#

# export STARTTIME=`date +%s`
export STARTTIME=`date`


mkdir build_osx
python id_mapper.py > build_osx/id_mappings.json

cd build_osx
cp ../set_config.py .
cp ../localnotes.py .
cp ../note.py .
cp ../index.py .
cat ../flask_server.py | python set_config.py > flask_server.py
cp ../config.py . 

mkdir static
cp ../id_map_js.py .
cp ../static/bootstrap.bundle.min.js static
cp ../static/bootstrap.min.css static
cp ../static/localnotes_icon.png static
cp ../static/notes.css static
uglifyjs  --compress --mangle toplevel ../static/notes.js --name-cache function_mappings.json -o static/notes.js
python id_map_js.py id_mappings.json static/notes.js


mkdir templates
cp ../obfuscate.py .
python obfuscate.py function_mappings.json id_mappings.json ../templates/config.html > templates/config.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/edit_note.html > templates/edit_note.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/export.html > templates/export.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/header.html > templates/header.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/image_edit_list.html > templates/image_edit_list.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/lists.html > templates/lists.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/list_notes.html > templates/list_notes.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/list_taglines.html > templates/list_taglines.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/notes.html > templates/notes.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/read_note.html > templates/read_note.html
python obfuscate.py function_mappings.json id_mappings.json ../templates/error.html > templates/error.html

pyinstaller -n localnotes -i static/localnotes_icon.png -w localnotes.py --onefile --add-data "templates:templates" --add-data "static:static"  -F --noconsole  ## someday add:  --osx-bundle-identifier 'localnotes'

# add the key-value pair that makes the icon not appear in the dock
mv dist/localnotes.app/Contents/Info.plist dist/localnotes.app/Contents/Info.plist.tmp
cat dist/localnotes.app/Contents/Info.plist.tmp | perl -pe "s/<dict>/<dict>\\n\\t<key>LSUIElement<\/key>\\n\\t<string>1<\/string>/" > dist/localnotes.app/Contents/Info.plist
rm dist/localnotes.app/Contents/Info.plist.tmp

cd dist
echo "Move the localnotes app into the Applications folder" > "Move the localnotes app into the Applications folder.txt"
zip localnotes_mac.zip -r "Move the localnotes app into the Applications folder.txt" localnotes.app

cd ..
cd ..

mv build_osx/dist/localnotes_mac.zip .

# export ENDTIME=`date +%s`
export ENDTIME=`date`

echo Started at $STARTTIME and ended at $ENDTIME

