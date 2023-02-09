import os
import sys
import math
import time

from flask import Flask, render_template, redirect, Response, request, send_file
from urllib.parse import quote, unquote

from typing import Union

import datetime
import dateutil, dateutil.parser
from dateutil.parser import ParserError
import markdown
import re
from operator import itemgetter
from collections import Counter

from note import Note
from index import Index
from config import Config

app = Flask(__name__)
cfg: Config = None
idx: Index = None


def make_date_histogram(note_list: list[Note], color: str) -> list[dict]:
    # grab the dates so we can make a histogram
    dates = [datetime.datetime.fromtimestamp(note.timestamp) for note in note_list]

    # show no more than 2 calendar years
    previous_year = datetime.datetime.now().year - 1
    first_day_to_show = datetime.datetime(previous_year, 1, 1)

    dates = Counter([datetime.date(dttm.year, dttm.month, dttm.day) for dttm in dates if dttm >= first_day_to_show])  # e.g. "2022-04-01"
    today = datetime.date.today()
    if len(dates) == 0:  # starting from scratch
        dates[today] = 0
    min_date = min(dates)

    # zero-fill dates with no observations
    m = min_date
    while m <= today:
        if m not in dates:
            dates[m] = 0
        m += datetime.timedelta(days=1)

    dates = [{'Date': str(dt)[:10], 'NoteCount': dates[dt]} for dt in dates]
    dates.sort(key=(lambda d: d['Date']))

    return dates


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


def get_bounds(num_elements: int, page_num: int, elem_per_page: int) -> (int, int, int):
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


@app.route('/tagline/<tag>')
def list_taglines(tag: str) -> (str, int):

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
            nl['taglines'].append(markdown.markdown(tl))
        if len(nl['taglines']):
            tagline_list.append(nl);

    all_tags = [(quote(t[0]), t[0], t[1]) for t in idx.get_tags()]
    all_people = [(quote(p[0]), p[0], p[1]) for p in idx.get_people()]

    d = {
        'context': 'tagline',
        'all_tags': all_tags, 'all_people': all_people,
        'tag': tag,
        'tag_quot': quote(tag),
        'tagline_list': tagline_list,
        'page_title': "Taglines for " + tag,
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
    }
    return render_template('notes.html', **d), 200


@app.route('/', methods=['GET'])
def list_notes() -> (str, int):

    search: str = request.args.get('search', "", str)
    filter_raw: str = request.args.get('filter', "", str)
    pg: int = request.args.get('pg', 1, int)
    nn: int = request.args.get('nn', cfg.get_num_notes_per_page(), int)
    sk: str = request.args.get('sk', ('search' if len(search) else 'timestamp'), str)
    so: str = request.args.get('so', 'desc', str)
    time_min: str = request.args.get('time_min', "2000-01-01 00:00:00", str)
    time_max: str = request.args.get('time_max', str(datetime.datetime.now())[:19], str)

    if len(search):
        search = unquote(search)

    list_of_notes = idx.get_notes_search(search) if search else idx.get_notes()

    filter_list: list = []
    if len(filter_raw):
        filter_list = [unquote(s) for s in re.split("[, +]", filter_raw)
        if ((len(s) > 1) and (s[0] in ['@', '#'])) or ((len(s) > 2) and (s[0] == '~') and (s[1] in ['@', '#']))]

    try:
        time_min_num = int(time.mktime(dateutil.parser.parse(time_min).timetuple()))
    except (ValueError, ParserError):
        time_min = "2000-01-01 00:00:00"
        time_min_num = int(time.mktime(dateutil.parser.parse(time_min).timetuple()))

    try:
        time_max_num = int(time.mktime(dateutil.parser.parse(time_max).timetuple()))
    except (ValueError, ParserError):
        time_max = str(datetime.datetime.now())[:19]
        time_max_num = int(time.mktime(dateutil.parser.parse(time_max).timetuple()))

    list_of_notes = [d for d in list_of_notes
                     if (time_min_num <= d.timestamp <= time_max_num) and matches_filter(d, filter_list)]

    # sort the list of notes
    fn = (lambda z: z.timestamp)  # default
    if sk == 'relevance':
        fn = (lambda z: z.score)

    list_of_notes.sort(key=fn, reverse=(so == 'desc'))
    date_histogram = make_date_histogram(list_of_notes, cfg.get_focal_color())
    n_years = len(set([d['Date'][:4] for d in date_histogram]))

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
        note_body_md = apply_markdown_and_links(note_body, n.timestamp)

        # highlighting search results is imperfect.  It is looking for the tokens in the search query, so we
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

    d = {'context': 'list',
         'page_title': page_title,
         'all_tags': all_tags, 'all_people': all_people,
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
         'min_note': min_, 'max_note': max_, 'n_pages': n_pages,
         'pg': pg, 'nn': nn, 'total_notes': total_notes,
         'search_str': search, 'filter_str': ', '.join(filter_list),
         'notes_list': notes_list,
         'date_histogram': date_histogram,
         'n_years': n_years,
         'sk': sk,
         'so': so,
         'time_min': time_min,
         'time_max': time_max
         }

    return render_template('notes.html', **d), 200


@app.route('/image/<int:note_id>/<int:img_num>')
def read_image(note_id: int, img_num: int) -> (str, int):
    path, fn = Index.get_image_path(note_id, img_num, cfg)
    filename = os.path.join(path, fn)
    return send_file(filename, mimetype='image/png')


def apply_markdown_and_links(note_body: str, note_id: int) -> str:

    note_body_md = markdown.markdown(note_body, extensions=['tables', 'attr_list'])

    # check note body of references to other notes, to tags, and to people
    note_refs = re.findall("note:([0123456789]+)", note_body_md)
    for note_ref in note_refs:
        # TODO: check to see if it's faster to read the file, or walk the list of notes in the index
        note_ref_note, _ = Index.read_note_file(int(note_ref), cfg)
        note_body_md = re.sub("note:{0}".format(note_ref),
                              "<a href=\"/note/{0}\">{1}</a>".format(note_ref, note_ref_note.title), note_body_md)

    # tags and people
    note_body_md = re.sub("#([a-z_\\d]+)", r'<a href="/?filter=%23\1">#\1</a>', note_body_md)
    note_body_md = re.sub("@([a-z_\\d]+)", r'<a href="/?filter=%40\1">@\1</a>', note_body_md)

    return note_body_md


@app.route('/note/<int:note_id>', methods=['GET'])
def read_note(note_id: int) -> (str, int):

    try:
        note, note_body = Index.read_note_file(note_id, cfg)

        # check note body for references to images
        image_refs = map(int, re.findall("<([0123456789]+)>", note_body))

        for image_num in image_refs:
            u = "/image/{0}/{1}".format(note_id, image_num)
            s = "<a href=\"{0}\" target=\"_new\"><img style=\"max-height:100px; max-width: 100%\" src=\"{0}\"></a>".format(u)
            note_body = re.sub("<{0}>".format(image_num), s, note_body)

        # if any images exist, put them at the bottom
        img_refs = idx.list_note_images(note_id, cfg)

        note_body_md = apply_markdown_and_links(note_body, note_id)

    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    dttm = datetime.datetime.fromtimestamp(note_id)
    last_edit_dttm = datetime.datetime.fromtimestamp(os.path.getmtime(note.get_file_name(cfg)))

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
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color()
         }

    return render_template("notes.html", **d), 200


@app.route('/image_del/<int:note_id>/<int:img_num>')
def delete_image(note_id: int, img_num: int) -> (str, int):
    path, fn = Index.get_image_path(note_id, img_num, cfg)
    filename = os.path.join(path, fn)
    os.unlink(filename)
    time.sleep(1)  # give the os a second to remove the file cleanly
    return redirect("/image_edit_list/{0}".format(note_id), code=302)


@app.route('/image_edit_list/<int:note_id>', methods=['GET'])
def show_image_edit_list(note_id: int) -> (str, int):

    # if any images exist, put them at the bottom
    img_refs = idx.list_note_images(note_id, cfg)

    d = {
        'id': note_id,
        'img_refs': img_refs,
        'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color()
    }

    return render_template("image_edit_list.html", **d)


@app.route('/edit/<int:note_id>', methods=['GET'])
def edit_note(note_id: int) -> (str, int):

    try:
        note, note_body = Index.read_note_file(note_id, cfg)
    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    pl = idx.get_people()
    pl = list(map(itemgetter(0), pl))

    d = {'context': 'edit',
         'id': note_id,
         'note_body': note_body,
         'page_title': note.title,
         'people_list': pl,
         'link_color': cfg.get_link_color(), 'alert_color': cfg.get_alert_color(), 'focal_color': cfg.get_focal_color(),
         }

    return render_template("notes.html", **d), 200


@app.route('/upload', methods=['POST'])
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

    path, fn = Index.get_image_path(id_, next_id, cfg)
    os.makedirs(path, exist_ok=True)
    filename = os.path.join(path, fn)
    file.save(filename)

    html = "<html><body>" + "Image saved as <" + str(next_id) + ">" + "</body></html>"
    return redirect("/image_edit_list/{0}".format(id_), code=302)


@app.route('/save', methods=['POST'])
def save_note() -> Union[Response, tuple[str, int]]:

    id_ = request.form.get('id', 0, int)
    text_ = request.form.get('big_text', "", str)

    try:
        # remove the old one from the index
        idx.remove_note_from_index(id_, save=False)

        # overwrite, then get a new note object
        Index.save_note_file(id_, text_, cfg)
        note, _ = Index.read_note_file(id_, cfg)

        # update the index for the revised note
        idx.add_note_to_index(note)

    except Exception as e:
        return "<html><body>Error: {0}</body></html>".format(str(e)), 500

    return redirect("/note/{0}".format(id_), code=302)


@app.route('/delete', methods=['POST'])
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
def new_note() -> Response:
    unix_time = idx.new_file()
    url = "/edit/{0}".format(unix_time)
    return redirect(url, code=302)


@app.route('/clone/<int:note_id>', methods=['GET'])
def clone_note(note_id: int) -> Union[Response, tuple[str, int]]:
    try:
        note, _ = Index.read_note_file(note_id, cfg)
    except FileNotFoundError:
        return "<html><body>File not found: {0}</body></html>".format(note_id), 404

    unix_time = idx.new_file(tag_list=note.tags, people_list=note.people, title=note.title)
    url = "/edit/{0}".format(unix_time)
    return redirect(url, code=302)


@app.route('/reindex', methods=['GET'])
def reindex() -> Response:
    idx.build(cfg)
    return redirect("/", code=302)


@app.route('/exit', methods=['GET'])
def exit_app() -> None:
    sys.exit()


def run_app(cfg_: Config) -> None:
    global app, cfg, idx
    cfg = cfg_
    idx = Index()
    idx.load(cfg)
    app.run(debug=False, port=cfg.get_http_port())
