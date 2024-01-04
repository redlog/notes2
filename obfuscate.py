import sys
import json
import re

#
# load the function mappings
#
with open(sys.argv[1], 'r') as fp:
    b = fp.read()
    fn_mappings = json.loads(b)['vars']['props']

fn_mappings = [ (k[1:], v) for k, v in fn_mappings.items() ]


#
# load the id mappings
#
with open(sys.argv[2], 'r') as fp:
    id_mappings = json.loads(fp.read())


#
# read and modify the html file
#
with open(sys.argv[3], 'r') as fp:
    htmlfile = fp.read()

for (real_name, fake_name) in fn_mappings:
    htmlfile = htmlfile.replace(real_name+"(", fake_name+"(")

for (real_id, fake_id) in id_mappings.items():
    htmlfile = re.sub("id=\"" + real_id + "\"", "id=\"" + fake_id + "\"", htmlfile)

sys.stdout.write(htmlfile)
