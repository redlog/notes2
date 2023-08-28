import hashlib
import os
import math
import signal
import time
import pprint

from flask import Flask, render_template, redirect, Response, request, send_file
import waitress
from urllib.parse import quote, unquote

from typing import Union

import datetime
import dateutil
import dateutil.parser
from dateutil.parser import ParserError
import markdown
import re
from operator import itemgetter
from html import escape

from note import Note
from index import Index
from config import Config

app = Flask(__name__)
cfg: Config = None
idx: Index = None


@app.route('/favicon.ico')
def favicon():
    return send_file("localnotes_icon.png", mimetype='image/png')


def matches_filter(note: Note, filter_list: list[str]):

    if len(filter_list) == 0:
        return True

    matched = [False for _ in range(len(filter_list))]

    for i, f in enumerate(filter_list):
        if f[0] == '~':
            f2 = f[1:]
            matched[i] = ((f2 not in note.tags) and (f2 not in note.people))
        else:
            matched[i] = ((f in note.tags) or (f in note.people))

    return set(matched) == {True}


def get_bounds(num_elements: int, page_num: int, elem_per_page: int) -> tuple[int, int, int]:
    """
    Example: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    Page: 1
    elements: 5
    should return (0, 4, 2)
    """

    first_element = (page_num - 1) * elem_per_page
    if first_element > num_elements:
        first_element = 0

    last_element = (page_num * elem_per_page) - 1
    if last_element >= num_elements:
        last_element = max(num_elements - 1, 0)

    num_pages = math.ceil(num_elements / elem_per_page)

    return first_element, last_element, num_pages


def check_index_integrity(func):

    def cii_inner(*args, **kwargs):
        local_hash = idx.get_local_index_hash(cfg)
        if local_hash != idx.hash_:
            # sys.stderr.write("Index hash {0} does not match local hash {1}.  Need to reload index!".format(idx.hash_, local_hash))
            idx.load(cfg)
        return func(*args, **kwargs)

    cii_inner.__name__ = func.__name__
    return cii_inner


@app.route('/tagline/<string:tag>')
@check_index_integrity
def list_taglines(tag: str) -> tuple[str, int]:

    list_of_notes = [note for note in idx.get_notes() if matches_filter(note, [tag])]

    # what we want to show is
    # tagline | date | link to note

    tagline_list = []
    for note in list_of_notes:
        nl = {
            'title': note.title,
            'timestamp': note.timestamp,
            'dttm_str': str(datetime.datetime.fromtimestamp(note.timestamp))[:10],
            'taglines': [],
        }
        _, body = Index.read_note_file(note.timestamp, cfg, parse=False)
        taglines = Note.get_taglines(body, tag)
        for tl in taglines:
            if tl.find("<!--") > -1:
                continue
            nl['taglines'].append(markdown.markdown(tl))
        if len(nl['taglines']):
            tagline_list.append(nl)

    all_tags = [(quote(t[0]), t[0], t[1]) for t in idx.get_tags()]
    all_people = [(quote(p[0]), p[0], p[1]) for p in idx.get_people()]

    d = {
        'context': 'tagline',
        'all_tags': all_tags, 'all_people': all_people,
        'tag': tag,
        'tag_quot': quote(tag),
        'tagline_list': tagline_list,
        'page_title': "Taglines for " + tag,
        'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
        'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
        'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
    }
    return render_template('notes.html', **d), 200


@app.route('/', methods=['GET'])
@check_index_integrity
def list_notes() -> tuple[str, int]:

    search: str = request.args.get('search', "", str)
    filter_raw: str = request.args.get('filter', "", str)
    pg: int = request.args.get('pg', 1, int)
    nn: int = request.args.get('nn', cfg.get_num_notes_per_page(), int)
    sk: str = request.args.get('sk', 'timestamp', str)
    so: str = request.args.get('so', 'desc', str)
    time_min: str = request.args.get('time_min', idx.get_min_time(), str)
    time_max: str = request.args.get('time_max', str(datetime.datetime.now())[:10], str)
    do_export: int = request.args.get('export', 0, int)

    # defaults
    if sk not in ('last_edit', 'relevance', 'timestamp'):
        sk = 'timestamp'
    if so not in ('asc', 'desc'):
        so = 'desc'

    if len(search):
        search = unquote(search)

    list_of_notes = idx.get_notes_search(search) if search else idx.get_notes()

    filter_list: list = []
    if len(filter_raw):
        filter_list = [unquote(s) for s in re.split("[, +]", filter_raw) if ((len(s) > 1) and (s[0] in ['@', '#'])) or ((len(s) > 2) and (s[0] == '~') and (s[1] in ['@', '#']))]

    try:
        time_min_num = int(time.mktime(dateutil.parser.parse(time_min[:10]).timetuple()))
    except (ValueError, ParserError):
        time_min = idx.get_min_time()
        time_min_num = int(time.mktime(dateutil.parser.parse(time_min).timetuple()))

    try:
        time_max_num = int(time.mktime(dateutil.parser.parse(time_max[:10]).timetuple()))
    except (ValueError, ParserError):
        time_max = str(datetime.datetime.now())[:10]
        time_max_num = int(time.mktime(dateutil.parser.parse(time_max).timetuple()))

    list_of_notes = [d for d in list_of_notes
                     if (time_min_num <= d.timestamp <= time_max_num + (60 * 60 * 24)) and matches_filter(d, filter_list)]

    # sort the list of notes
    fn = (lambda z: z.timestamp)  # default
    if sk == 'relevance':
        fn = (lambda z: z.score)
    if sk == 'last_edit':
        fn = (lambda z: z.last_edit_time)
    list_of_notes.sort(key=fn, reverse=(so == 'desc'))

    if do_export:
        return export(list_of_notes, search, filter_raw)

    # paginate
    total_notes = len(list_of_notes)
    min_, max_, n_pages = get_bounds(len(list_of_notes), pg, nn)
    note_subset: list[Note] = list_of_notes[min_:max_ + 1]

    all_tags = [(quote(t[0]), t[0], t[1]) for t in idx.get_tags()]
    all_people = [(quote(p[0]), p[0], p[1]) for p in idx.get_people()]

    # sort tags by count, descending
    all_tags.sort(key=itemgetter(2), reverse=True)

    # sort people by name
    all_people.sort(key=itemgetter(0))

    notes_list = []
    for n in note_subset:
        _, note_body = Index.read_note_file(n.timestamp, cfg, parse=False)

        # could just do rendering markdown, which is simpler i.e. markdown.markdown(note_body)
        note_body = apply_images(note_body, n.timestamp)
        note_body_md = apply_markdown_and_links(note_body)

        # XXX: highlighting search results is imperfect.  It is looking for the tokens in the search query, so we
        # can't highlight the actual trigrams that we're indexing on when trigram search, and since it uses
        # the tokens as substrings, it'll find them even when they are _not_ in the index, in word-based search
        if len(search):
            for s in search.split():
                note_body_md = note_body_md.replace(s, "<span style=\"background-color: #ffff00\">{0}</span>".format(s))

        d = {
            'tag_list': [(quote(t), t) for t in n.tags],
            'people_list': [(quote(p), p) for p in n.people],
            'timestamp': n.timestamp,
            'dttm_str': str(datetime.datetime.fromtimestamp(n.timestamp))[:19],
            'last_edit_str': str(datetime.datetime.fromtimestamp(n.last_edit_time))[:19],
            'note_body_md': note_body_md,
            'title': n.title,
            'score': n.score
        }
        notes_list.append(d)

    page_title = ""
    if len(search):
        page_title += "\"" + search + "\""
    if len(filter_list):
        page_title += "\"" + ', '.join(filter_list) + "\""

    d = {'context': 'list', 'compact': cfg.get_list_compact(),  # compact flag is currently unused
         'page_title': page_title,
         'all_tags': all_tags, 'all_people': all_people,
         'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
         'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
         'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
         'min_note': min_, 'max_note': max_, 'n_pages': n_pages,
         'pg': pg, 'nn': nn, 'total_notes': total_notes,
         'search_str': search, 'filter_str': ', '.join(filter_list),
         'notes_list': notes_list,
         'sk': sk,
         'so': so,
         'time_min': time_min,
         'time_max': time_max
         }

    return render_template('notes.html', **d), 200


@app.route('/image/<int:note_id>/<int:img_num>')
@check_index_integrity
def read_image(note_id: int, img_num: int) -> Response:
    path, filename = Index.get_image_path(note_id, img_num, cfg)
    return send_file(os.path.join(path, filename), mimetype='image/png')


def apply_markdown_and_links(note_body: str) -> str:

    note_body_md = markdown.markdown(note_body, extensions=['tables', 'attr_list'])

    # check note body of references to other notes, to tags, and to people
    note_refs = re.findall("note:([0123456789]+)", note_body_md)
    for note_ref in note_refs:
        # TODO: check to see if it's faster to read the file, or walk the list of notes in the index
        try:
            note_ref_note, _ = Index.read_note_file(int(note_ref), cfg)
            note_body_md = re.sub("note:{0}".format(note_ref),
                                  "<a href=\"/note/{0}\">{1}</a>".format(note_ref, note_ref_note.title), note_body_md)
        except FileNotFoundError:
            note_body_md = re.sub("note:{0}".format(note_ref),
                                  "<u>Note not found! {0}</u>".format(note_ref), note_body_md)

    # tags and people
    note_body_md = re.sub("#([a-z_\\d]+)", r'<a href="/?filter=%23\1">#\1</a>', note_body_md)
    note_body_md = re.sub("@([a-z_\\d]+)", r'<a href="/?filter=%40\1">@\1</a>', note_body_md)

    return note_body_md


def apply_images(note_body: str, note_id: int) -> str:
    image_refs = map(int, re.findall("<([0123456789]+)>", note_body))
    for image_num in image_refs:
        u = "/image/{0}/{1}".format(note_id, image_num)
        s = "<a href=\"{0}\" target=\"_new\"><img class=\"img_embedded\" src=\"{0}\"></a>".format(
            u)
        note_body = re.sub("<{0}>".format(image_num), s, note_body)
    return note_body


@app.route('/note/<int:note_id>', methods=['GET'])
@check_index_integrity
def read_note(note_id: int) -> tuple[str, int]:

    try:
        note, note_body = Index.read_note_file(note_id, cfg)

        # check note body for references to images
        note_body = apply_images(note_body, note_id)

        # if any images exist, put them at the bottom
        img_refs = idx.list_note_images(note_id, cfg)

        note_body_md = apply_markdown_and_links(note_body)

    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    dttm = datetime.datetime.fromtimestamp(note_id)
    last_edit_dttm = datetime.datetime.fromtimestamp(note.get_last_edit_time())

    d = {'context': 'read',
         'id': note_id,
         'tag_list': [(quote(t), t) for t in note.tags],
         'people_list': [(quote(p), p) for p in note.people],
         'timestamp_str': str(dttm)[:19],
         'filename': note.get_file_name(cfg),
         'note_body_md': note_body_md,
         'img_refs': img_refs,
         'last_edit_dttm': str(last_edit_dttm)[:19],
         'page_title': note.title,
         'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
         'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
         'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
         }

    return render_template("notes.html", **d), 200


@app.route('/image_del/<int:note_id>/<int:img_num>')
@check_index_integrity
def delete_image(note_id: int, img_num: int) -> Response:
    path, filename = Index.get_image_path(note_id, img_num, cfg)
    os.unlink(os.path.join(path, filename))
    time.sleep(1)  # give the os a second to remove the file cleanly
    return redirect("/image_edit_list/{0}".format(note_id), code=302)


@app.route('/image_edit_list/<int:note_id>', methods=['GET'])
@check_index_integrity
def show_image_edit_list(note_id: int) -> tuple[str, int]:

    # if any images exist, put them at the bottom
    img_refs = idx.list_note_images(note_id, cfg)

    d = {
        'id': note_id,
        'img_refs': img_refs,
        'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
        'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
        'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
    }

    return render_template("image_edit_list.html", **d), 200


@app.route('/edit/<int:note_id>', methods=['GET'])
@check_index_integrity
def edit_note(note_id: int) -> tuple[str, int]:

    try:
        note, note_body = Index.read_note_file(note_id, cfg)
    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    starting_hash = hashlib.md5(note_body.encode("utf-8")).hexdigest()

    r = Index.lock_note(note_id, cfg)

    if not r:
        d = {
            'context': 'error',
            'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
            'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
            'focal_color': cfg.get_focal_color(),
            'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
            'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
            'page_title': "Error: note {0} is being edited in another window.".format(note_id),
            'message': "Error: note {0} is being edited in another window.<br /><br /><i>Lock file: {1}</i>".format(
                note_id, Index.get_lock_file_name(note_id, cfg))
        }
        return render_template("notes.html", **d), 403

    pl = idx.get_people()
    pl = list(map(itemgetter(0), pl))

    d = {'context': 'edit',
         'id': note_id,
         'note_body': note_body,
         'page_title': note.title,
         'people_list': pl,
         'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
         'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
         'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
         'starting_hash': starting_hash
         }

    return render_template("notes.html", **d), 200


@app.route('/upload', methods=['POST'])
@check_index_integrity
def upload_image() -> Union[Response, tuple[str, int]]:

    id_ = request.form.get('id', 0, int)
    img_refs = idx.list_note_images(id_, cfg)
    next_id = 1
    if img_refs:
        next_id = max(img_refs) + 1

    ok_str = "<br /><br /><a href=\"/image_edit_list/{0}\">OK</a>".format(id_)

    if 'img_file' not in request.files:
        return "<html><body>" + "No file part" + ok_str + "</body></html>", 400

    file = request.files['img_file']
    if file.filename == '':
        return "<html><body>" + "No selected file" + ok_str + "</body></html>", 400

    if not file.filename.lower().endswith(".png"):
        return "<html><body>" + "File must be png" + ok_str + "</body></html>", 400

    path, filename = Index.get_image_path(id_, next_id, cfg)
    os.makedirs(path, exist_ok=True)
    file.save(os.path.join(path, filename))

    return redirect("/image_edit_list/{0}".format(id_), code=302)


@app.route('/config')
@check_index_integrity
def config() -> tuple[str, int]:
    d = {
        'context': 'config',
        'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
        'focal_color': cfg.get_focal_color(),
        'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
        'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
        'config_file_path': Config.get_config_file_name(),
        'config_txt': pprint.pformat(Config.read_config_file()),
        'index_path': idx.get_index_filename(),
        'project_config_txt': pprint.pformat(idx.get_project_config())
    }
    return render_template("notes.html", **d), 200


@app.route('/cancel/<int:note_id>', methods=['GET'])
@check_index_integrity
def cancel_edit(note_id: int) -> Union[Response, tuple[str, int]]:
    r = Index.unlock_note(note_id, cfg)
    if not r:
        d = {
            'context': 'error',
            'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
            'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
            'focal_color': cfg.get_focal_color(),
            'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
            'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
            'page_title': "Error: note {0} was not previously locked for edit.".format(note_id),
            'message': "Error: note {0} was not previously locked for edit.<br /><br /><i>Lock file: {1}</i>".format(
                note_id, Index.get_lock_file_name(note_id, cfg))
        }
        return render_template("notes.html", **d), 403
    return redirect("/note/{0}".format(note_id), code=302)


@app.route('/save', methods=['POST'])
@check_index_integrity
def save_note() -> Union[Response, tuple[str, int]]:

    id_ = request.form.get('id', 0, int)
    text_ = request.form.get('big_text', "", str)
    starting_hash = request.form.get('starting_hash', "", str)

    r = Index.unlock_note(id_, cfg)
    if not r:
        d = {
            'context': 'error',
            'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
            'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
            'focal_color': cfg.get_focal_color(),
            'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
            'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
            'page_title': "Error: note {0} was not previously locked for edit.".format(id_),
            'message': "Error: note {0} was not previously locked for edit.<br /><br /><i>Lock file: {1}</i>".format(
                id_, Index.get_lock_file_name(id_, cfg))
        }
        return render_template("notes.html", **d), 403

    _, current_note_body = Index.read_note_file(id_, cfg)
    current_hash = hashlib.md5(current_note_body.encode("utf-8")).hexdigest()

    if starting_hash != current_hash:
        d = {
            'context': 'error',
            'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
            'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
            'focal_color': cfg.get_focal_color(),
            'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
            'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
            'page_title': "Error: note {0} has changed unexpectedly!".format(id_),
            'message': "Error: note {0} has changed unexpectedly!<br /><br /><i>Starting hash: {1}<br />Current hash: {2}</i><br /><br />File not saved, since doing so would overwrite more recent changes.  To save your changes, copy the raw markdown below into another file and try again.<br /><br /><pre style=\"background-color: #cccccc\">{3}</pre>".format(
                id_, starting_hash, current_hash, escape(text_))
        }
        return render_template("notes.html", **d), 403

    # remove the old one from the index
    idx.remove_note_from_index(id_, save=False)

    # overwrite, then get a new note object
    Index.save_note_file(id_, text_, cfg)
    note, _ = Index.read_note_file(id_, cfg)

    # update the index for the revised note
    idx.add_note_to_index(note)

    return redirect("/note/{0}".format(id_), code=302)


@app.route('/delete', methods=['POST'])
@check_index_integrity
def delete_note() -> Response:

    id_ = request.form.get('id', 0, int)
    delete_text = request.form.get('delete_text', "", str)

    if delete_text == 'delete':
        # do it
        idx.remove_note_from_index(id_)
        Index.delete_note_file(id_, cfg)
        return redirect("/", code=302)
    else:
        # go back
        url = "/note/{0}".format(id_)
        return redirect(url, code=302)


@app.route('/new', methods=['GET'])
@check_index_integrity
def new_note() -> Response:
    unix_time = idx.new_file()
    url = "/edit/{0}".format(unix_time)
    return redirect(url, code=302)


@app.route('/clone/<int:note_id>', methods=['GET'])
@check_index_integrity
def clone_note(note_id: int) -> Union[Response, tuple[str, int]]:
    try:
        note, _ = Index.read_note_file(note_id, cfg)
    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    unix_time = idx.new_file(tag_list=note.tags, people_list=note.people, title=note.title)
    url = "/edit/{0}".format(unix_time)
    return redirect(url, code=302)


@app.route('/reindex', methods=['GET'])
@check_index_integrity
def reindex() -> Response:
    idx.build(cfg)
    return redirect("/", code=302)


def export(list_of_notes: list[Note], search_str: str, filter_str: str) -> tuple[str, int]:

    dttm = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    filename = 'notes_export_' + dttm + '.html'
    export_file_path = os.path.join(cfg.get_base_path(), cfg.get_notes_dir(), filename)
    num_notes = len(list_of_notes)

    big_body = """<html>
    <head>
        <title>{0} notes exported at {1}</title>
        <body>
            <p>
            <a name="contents" />
            <h1>Contents</h1>
            Search string: {2}
            <br />
            Query string: {3}
            <br />
            <br />
            {0} notes exported {1}
            <br />
            <ul>           
    """.format(num_notes, dttm, search_str or "(none)", filter_str or "(none)")

    for n in list_of_notes:
        big_body += "<li><a href=\"#note_{0}\">{1}</a></li>".format(n.timestamp, n.title)

    big_body += "</ul></p>\n\n<hr />\n\n"

    for n in list_of_notes:
        _, note_body = Index.read_note_file(n.timestamp, cfg, parse=False)
        note_body = apply_images(note_body, n.timestamp)
        note_body_md = apply_markdown_and_links(note_body)
        big_body += "<a name=\"note_{0}\" />".format(n.timestamp)
        big_body += note_body_md
        big_body += "<br /><a href=\"#contents\">back to top</a>\n\n<hr />\n\n"

    footer = "</body></html>"

    with open(export_file_path, 'w') as fp:
        fp.write(big_body)

    d = {
        'context': 'export',
        'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
        'focal_color': cfg.get_focal_color(),
        'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
        'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
        'export_file_path': export_file_path, 'num_notes': num_notes
    }
    return render_template("notes.html", **d), 200

@app.route('/project', methods=['GET'])
@check_index_integrity
def change_project() -> Union[Response, tuple[str, int]]:
    global cfg, idx

    project_name = request.args.get('project_name', None, str)
    ok = cfg.set_active_project(project_name)

    if not ok:
        d = {
            'context': 'error',
            'active_project': cfg.get_active_project_name(), 'project_list': cfg.get_project_list(),
            'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(),
            'focal_color': cfg.get_focal_color(),
            'background_color': cfg.get_background_color(), 'text_color': cfg.get_text_color(),
            'header_color': cfg.get_header_color(), 'sidebar_color': cfg.get_sidebar_color(),
            'page_title': "Error: Invalid or unknown project name: {0}".format(project_name),
            'message': "Error: Invalid or unknown project name: {0}".format(project_name)
        }
        return render_template("notes.html", **d), 400

    idx = Index()
    idx.load(cfg)

    return redirect("/", code=302)



@app.route('/exit_cleanly', methods=['GET'])
def exit_cleanly():
    os.kill(os.getpid(), signal.SIGTERM)
    return "<html><body>exit_cleanly</body></html>", 200


def run_app(cfg_: Config) -> None:
    global app, cfg, idx
    cfg = cfg_
    idx = Index()
    idx.load(cfg)

    print("Localnotes server is running at http://localhost:{0}\n".format(cfg.get_http_port()))
    waitress_server = waitress.server.WSGIServer(app, listen="127.0.0.1:{0}".format(cfg.get_http_port()))
    waitress_server.run()