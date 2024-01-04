import sys
import json
import re

map_file = sys.argv[1]
filename = sys.argv[2]

with open(filename, 'r') as fp:
    body = fp.read()

with open(map_file, 'r') as fp:
    id_mappings = json.loads(fp.read())

for (real_id, fake_id) in id_mappings.items():
    body = re.sub("\"" + real_id + "\"", "\"" + fake_id + "\"", body)
    body = re.sub("\"#" + real_id + "\"", "\"#" + fake_id + "\"", body)  # for jquery 


with open(filename, 'w') as fp:
    fp.write(body)
