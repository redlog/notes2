
function expand_delete() {
    d = document.getElementById("delete_form_div");
    d.style.display = "";
}

function hide_delete() {
    d = document.getElementById("delete_form_div");
    d.style.display = "none";
}

function set_scrollable_div_height(div_id)
{
    var d = document.getElementById(div_id);
    var vh = window.innerHeight;
    var top = d.getBoundingClientRect().top;
    var currHeight = d.style.height;
    var newHeight = vh - top - 40;
    d.style.height = "" + newHeight + "px";
}

function textarea_sans() {
    var textarea = document.getElementById("big_text");
    textarea.classList.remove("txt_mono");
    textarea.classList.remove("txt_serif");
    textarea.classList.add("txt_sans");
}

function textarea_mono() {
    var textarea = document.getElementById("big_text");
    textarea.classList.remove("txt_sans");
    textarea.classList.remove("txt_serif");
    textarea.classList.add("txt_mono");
}

function textarea_serif() {
    var textarea = document.getElementById("big_text");
    textarea.classList.remove("txt_sans");
    textarea.classList.remove("txt_mono");
    textarea.classList.add("txt_serif");
}

function image_edit_frame_show() {
    var fr = document.getElementById("ul_image_div");
    fr.style.display = "";
}

function image_edit_frame_hide() {
    var fr = document.getElementById("ul_image_div");
    fr.style.display = "none";
}


function info_pane_show() {
    var fr = document.getElementById("ul_info_div");
    fr.style.display = "";
}

function info_pane_hide() {
    var fr = document.getElementById("ul_info_div");
    fr.style.display = "none";
}


function show_tag_filter_span()
{
    var d = document.getElementById("tag_filter_span");
    d.style.display="";
    document.getElementById("tag_filter_text").focus();
}

function show_people_filter_span()
{
    var d = document.getElementById("people_filter_span");
    d.style.display="";
    document.getElementById("people_filter_text").focus();
}

function show_tl(tag_quot)
{
    $('.tag_tl').each(
        function()
        {
            if ($(this).data('tagquot') == tag_quot) {
                $(this).attr("style", "visibility:visible");
            }
        }
    );
}

function hide_tl(tag_quot)
{
    $('.tag_tl').each(
        function()
        {
            if ($(this).data('tagquot') == tag_quot) {
                $(this).attr("style", "visibility:hidden");
            }
        }
    );
}

// adapted from: https://stackoverflow.com/questions/6637341/use-tab-to-indent-in-textarea
function text_area_listener(e)
{
    if (e.key == 'Tab')
    {
        e.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;

        // de-indent
        if (e.shiftKey)
        {
            if (start >= 6 && this.value.substring(start - 6, start) == "    * ")
            {
                this.value = this.value.substring(0, start - 6) + "* " + this.value.substring(start);
                this.selectionEnd = start - 4;
            }
            return;
        }

        // indent
        if (start >= 2 && this.value.substring(start - 2, start) == "* ")
        {
            this.value = this.value.substring(0, start - 2) + "    " + this.value.substring(start - 2);
            this.selectionEnd = start + 4;
            return;
        }

        // default behavior: set textarea value to: text before caret + tab + text after caret
        this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 4;         // put caret at right position again
    }

    if (e.key == 'Backspace')
    {
        var start = this.selectionStart;
        var end = this.selectionEnd;

        if (this.value.substring(start - 4, start) == "    ")
        {
            e.preventDefault();
            this.value = this.value.substring(0, start - 4) + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start - 4;
        }
    }

    if (e.key == 'Enter')
    {
        // figure out if the previous line was bulleted, and bullet this one the same way
        var idx = this.selectionStart;
        this.selectionEnd = idx; // don't respect the selection
        var lidx = this.value.substring(0, idx).lastIndexOf('\n');
        if (lidx > -1)
        {
            const regex = /^(?<indent>\s+\* )/
            var currentLine = this.value.substring(lidx, idx);
            var result = currentLine.match(regex);
            if (result)
            {
                e.preventDefault();
                var indent = result.groups["indent"];
                if (currentLine.endsWith("* "))
                {
                    // make this line not bulleted
                    this.value = this.value.substring(0, lidx) + "\n" + this.value.substring(idx);
                    this.selectionStart = this.selectionEnd = lidx + 1;
                }
                else
                {
                    // match the previous line's indent
                    this.value = this.value.substring(0, idx) + indent + this.value.substring(idx);
                    this.selectionStart = this.selectionEnd = idx + indent.length;
                }
            }
        }
    }

    if (e.key == '@')
    {
        e.preventDefault();
        show_people_autocomplete();
    }

    if (e.key == '.')
    {
        if (e.ctrlKey)
        {

            document.getElementById('note_link_text_field').value = "";
            $('#title_search_ul').empty();

            var ul = document.getElementById('title_search_ul');
            var li = document.createElement('li');
            var t = document.createTextNode("matching note titles will show here");
            var i = document.createElement('i');
            i.append(t);
            li.append(i);
            ul.append(li);

            document.getElementById('ul_note_link_div').style.display = "";
            document.getElementById('note_link_text_field').focus();
        }
    }
}

function people_autocomplete_listener(e)
{
    if (e.key == 'Enter')
    {
        // insert the name into the textarea
        insert_people_autocomplete();
    }

    if (e.key == 'Escape')
    {
        // hide and go back
        hide_people_autocomplete();
    }
}

function insert_people_autocomplete()
{
        var d = document.getElementById('big_text');
        var start = d.selectionStart;
        var end = d.selectionEnd;

        var v = document.getElementById("people_autocomplete_text_field").value;
        if (v.startsWith('@') == false) {
            v = '@' + v
        }
        d.value = d.value.substring(0, start) + v + " " + d.value.substring(end);
        d.selectionStart = d.selectionEnd = start + v.length + 1;

        hide_people_autocomplete();
}


function hide_people_autocomplete()
{
        document.getElementById("people_autocomplete_div").style.display = "none";
        document.getElementById('big_text').focus();
}

function note_link_listener(e)
{
    if (e.key == 'Escape')
    {
        // hide and go back
        close_title_search();
    }
    if (e.key == 'Enter')
    {
        do_title_search();
    }
}

function close_title_search()
{
    document.getElementById('ul_note_link_div').style.display = "none";
    document.getElementById('note_link_text_field').value = "";
    document.getElementById('big_text').focus();
}

function do_title_search()
{
    document.getElementById("title_search_btn").disabled = true;
    payload = { 'search_str': document.getElementById('note_link_text_field').value };
    $('#title_search_ul').empty();

    var ul = document.getElementById('title_search_ul');
    var li = document.createElement('li');
    var t = document.createTextNode("searching...");
    var i = document.createElement('i');
    i.append(t);
    li.append(i);
    ul.append(li);

    $.get("/api/title_search", payload).done(do_title_search_callback);
    document.getElementById('note_link_text_field').focus();
}

function do_title_search_callback(data)
{
        $('#title_search_ul').empty();
        var ul = document.getElementById('title_search_ul');

        if (data['error_message'].length > 0)
        {
            var li = document.createElement('li');
            var t = document.createTextNode(data['error_message']);
            li.append(t);
            ul.append(li);
        }
        else
        {
            if (data['contents'].length == 0)
            {
                var li = document.createElement('li');
                var t = document.createTextNode("No results found");
                li.append(t);
                ul.append(li);
            }
            else
            {
                for (var i = 0; i < data['contents'].length; i++)
                {
                    var li = document.createElement('li');
                    var a = document.createElement('a');
                    a.appendChild(document.createTextNode(data['contents'][i].title));
                    a.setAttribute("href", "#");
                    a.setAttribute("data-timestamp", data['contents'][i].timestamp.toString());

                    $(a).click(
                        function()
                        {
                            insert_note_link($(this).data("timestamp"));
                        }
                    );

                    li.append(a);
                    li.append(document.createTextNode(" ["));
                    a2 = document.createElement('a');
                    a2.setAttribute('target', 'new_' + data['contents'][i].timestamp.toString());
                    a2.setAttribute('href', "/note/" + data['contents'][i].timestamp.toString());
                    a2.appendChild(document.createTextNode("open"));
                    li.append(a2);
                    li.append(document.createTextNode("]"));
                    ul.append(li);
                }
                if (data['contents'].length == 25)
                {
                    var li = document.createElement('li');
                    var t = document.createTextNode("Maximum of 25 results shown");
                    li.append(t);
                    ul.append(li);
                }
            }
        }
        document.getElementById("title_search_btn").disabled = false;
}

function insert_note_link(link_id)
{
    var d = document.getElementById('big_text');
    var start = d.selectionStart;

    var before = d.value.substring(0, start);
    var after = d.value.substring(start);

    var s = "note:" + link_id.toString();

    d.value = before + " " + s + " " + after;
    d.selectionStart = start + s.length + 2;
    d.selectionEnd = d.selectionStart;
    close_title_search();
    d.focus();
}


function page_load(context, active_project, sort_order, sort_key)
{
    document.getElementById("project_name").value = active_project;

    document.getElementById("input_search").addEventListener("keydown", form_submitter);
    document.getElementById("input_filter").addEventListener("keydown", form_submitter);
    document.getElementById("input_time_min").addEventListener("keydown", form_submitter);
    document.getElementById("input_time_max").addEventListener("keydown", form_submitter);

    $( function() { $("#input_time_min").datepicker( { dateFormat: "yy-mm-dd" } ); } );
    $( function() { $("#input_time_max").datepicker( { dateFormat: "yy-mm-dd" } ); } );

    if (context == 'list' || context == 'tagline')
    {

        set_scrollable_div_height('tags_div');
        set_scrollable_div_height('people_div');
        set_scrollable_div_height('list_div');
        window.addEventListener("resize",
            function (e)
            {
                set_scrollable_div_height('tags_div');
                set_scrollable_div_height('people_div');
                set_scrollable_div_height('list_div');
            }
        );


        document.getElementById("people_filter_text").addEventListener("input",
            function()
            {
                var substring = document.getElementById("people_filter_text").value;
                table_filter("all_people_table", substring);
            }
        );

        document.getElementById("people_filter_text").addEventListener('keydown',
            function (e) {
                if (e.key == 'Escape')
                {
                    document.getElementById('people_filter_text').value = '';
                    document.getElementById('people_filter_span').style.display = "none";
                    table_filter("all_people_table", "");
                }
            }
        );

        document.getElementById("tag_filter_text").addEventListener("input",
            function()
            {
                var substring = document.getElementById("tag_filter_text").value;
                table_filter("all_tag_table", substring);
            }
        );

        document.getElementById("tag_filter_text").addEventListener('keydown',
            function (e) {
                if (e.key == 'Escape')
                {
                    document.getElementById('tag_filter_text').value = '';
                    document.getElementById('tag_filter_span').style.display = "none";
                    table_filter("all_tag_table", "");
                }
            }
        );
        document.getElementById("input_search").focus();

        if (context == 'list')
        {
            document.getElementById("dropdown_so").value = sort_order;
            document.getElementById("dropdown_sk").value = sort_key;
        }
    }

    if (context == "edit")
    {
        set_scrollable_div_height('ul_image_div');

        var d = document.getElementById('big_text');
        var vh = window.innerHeight;
        var top = d.getBoundingClientRect().top;
        var currHeight = d.style.height;
        var newHeight = vh - top - 80;
        d.style.height = "" + newHeight + "px";

        window.addEventListener("resize",
            function (e)
            {
                set_scrollable_div_height('ul_image_div');

                // resize big_text
                var d = document.getElementById('big_text');
                var vh = window.innerHeight;
                var top = d.getBoundingClientRect().top;
                var currHeight = d.style.height;
                var newHeight = vh - top - 80;
                d.style.height = "" + newHeight + "px";
            }
        );


        document.getElementById('big_text').addEventListener('keydown', text_area_listener);
        document.getElementById('people_autocomplete_text_field').addEventListener('keyup',
            people_autocomplete_listener);

        document.getElementById('note_link_text_field').addEventListener('keyup', note_link_listener);

        setTimeout(do_autosave, AUTOSAVE_SECONDS * 1000);
    }
}

function do_autosave()
{
    if ($('#autosave_check').is(":checked"))
    {
        document.getElementById("edit_form_save_btn").disabled = true;
        document.getElementById("edit_form_cancel_btn").disabled = true;

        payload = {
            'id': parseInt(document.getElementById("id").value),
            'starting_hash': document.getElementById('starting_hash').value,
            'big_text': document.getElementById('big_text').value
            };

        $.get("/api/autosave", payload).done(do_autosave_callback);
    }
    else
    {
        setTimeout(do_autosave, AUTOSAVE_SECONDS * 1000);
    }
}

function do_autosave_callback(data)
{
        if (data['error_message'].length > 0)
        {
            alert(data['error_message']);
        }
        else
        {
            document.getElementById('starting_hash').value = data['starting_hash'];
            document.title = "Editing " + data['title'] + "(last saved at " + data['starting_hash'] + ")";
            document.getElementById("edit_form_save_btn").disabled = false;
            document.getElementById("edit_form_cancel_btn").disabled = false;
            setTimeout(do_autosave, AUTOSAVE_SECONDS * 1000);
        }
}

function form_submitter(e)
{
    if (e.key == 'Enter')
    {
        submit_search_form();
    }
}

$( function() {
    $( "#people_autocomplete_text_field" ).autocomplete(
        {
          source: function( request, response ) {
            var matches = $.map( availablePeople, function(acItem) {
              if ( acItem.toUpperCase().indexOf(request.term.toUpperCase()) != -1 ) {
                return acItem;
              }
            });
            response(matches);
          }
        }
    );
}
);


function show_people_autocomplete()
{
    var d = document.getElementById("people_autocomplete_text_field");
    d.value = "";
    l = d.value.length;
    d.setSelectionRange(l, l);

    document.getElementById("people_autocomplete_div").style.display = "inline";
    d.focus();
}

function compare(v1, v2, recordkeeper)
{
    if (recordkeeper == 'c')
    {
        i1 = parseInt(v1);
        i2 = parseInt(v2);
        //alert("v1 = " + v1 + "   v2 = " + v2)
        if (i1 > i2) { return 1; }
        if (i1 < i2) { return -1; }
        return 0;
    }
    else
    {
        return v1.localeCompare(v2);
    }
}

function table_filter(table_id, substring)
{
    var table = $('#' + table_id);
    var ss = substring.toLowerCase();
    $('#'+table_id + " tr").each(
        function(i, row)
        {
            if (ss.length == 0)
            {
                row.style.display = '';
                return;
            }
            var value = $('td:first', row).text().toLowerCase();
            var result = value.indexOf(ss);
            if (result > 0)
            {
                row.style.display = "";
            }
            else
            {
                row.style.display = "none";
            }
        }
    );
}

function table_sort(sort_table, recordkeeper)
{
    var tbody_id = "";
    var sort_order_element = undefined;

    if (sort_table == "p") {
        tbody_id = "all_people_tbody";
        if (recordkeeper == "n") { sort_order_element = "all_people_table_name_order"; }
        if (recordkeeper == "c") { sort_order_element = "all_people_table_count_order"; }
    }

    if (sort_table == "t") {
        tbody_id = "all_tag_tbody";
        if (recordkeeper == "n") { sort_order_element = "all_tag_table_name_order"; }
        if (recordkeeper == "c") { sort_order_element = "all_tag_table_count_order"; }
    }

    var tbody = $('#' + tbody_id);
    sort_order = document.getElementById(sort_order_element).value;

    var idx = 'first';
    if (recordkeeper == 'c') {
        idx = 'last';
    }

    tbody.find('tr').sort(
        function(a, b)
        {
            var at = $('td:'+idx, a).text();
            var bt = $('td:'+idx, b).text();

            if (sort_order == 'asc')
            {
                return compare(at, bt, recordkeeper);
            }
            else
            {
                return compare(bt, at, recordkeeper);
            }
        }
    ).appendTo(tbody);

    if(sort_order == "asc") {
        document.getElementById(sort_order_element).value = "desc";
    } else {
        document.getElementById(sort_order_element).value = "asc";
    }
}

function submit_list_form()
{
    frm = document.getElementById('list_form');
    frm.submit();
}

// by default a new search should sort by decreasing relevance
function submit_search_form()
{
    var input_sk = document.getElementById('input_sk');
    var input_so = document.getElementById('input_so');
    var srch = document.getElementById('input_search').value;

    // default
    input_sk.value = 'timestamp';
    input_so.value = 'desc';

    if (srch.length > 0) {
        input_sk.value = 'relevance';
        input_so.value = 'desc';
    }

    submit_list_form();
}

function re_sort_list()
{
    document.getElementById('input_sk').value = document.getElementById('dropdown_sk').value;
    document.getElementById('input_so').value = document.getElementById('dropdown_so').value;
    submit_list_form();
}

function export_notes()
{
    document.getElementById('input_export').value = 1;
    submit_list_form();
}

function go_to_page(pg_num)
{
    var v = document.getElementById('input_pg');
    v.value = pg_num;
    submit_list_form();
}


function collapse_messages() {
    $('.msg_body').each(
        function()
        {
            $(this).attr("style", "display:none");
        }
    );
}

function expand_messages() {
    $('.msg_body').each(
        function()
        {
            do_expand($(this), $(this).data("timestamp"));
        }
    );
}

function expand_note(timestamp)
{
    $('.msg_body').each(
        function()
        {
            if ($(this).data('timestamp') == timestamp) {
                do_expand($(this), $(this).data("timestamp"));
            }
        }
    );
}


function do_expand(obj, timestamp)
{
    var current_body = obj.html();
    if (current_body.length == 0)
    {
        var ts_int = parseInt(timestamp);

        $.get("/api/rendered_note_body", {'id': ts_int})
            .done(
                function (data)
                {
                    obj.html("<hr />" + data['body'] + "<hr />");
                }
            );
    }
    obj.css("display", "inline");
}