# Notes

## Introduction

Notes -- a deliberately simple name for a deliberately simple app -- exists because of the belief that taking good notes is a key to success.  Being able to easily capture and refer back to your notes enables you to stay organized, accomplish things more efficiently, and never forget or lose track of anything.

Once upon a time, I took all my work notes in OneNote.  But when my employer switched from MS Office to the Google suite, I lost access to OneNote.  With some crafty use of [`strings`](https://en.wikipedia.org/wiki/Strings_(Unix)) and `grep` I was able to recover my notes, albeit disorganized and without formatting.  But from that day forward, I vowed never to store my notes in anything except plain-old ascii on my local machine ever again.

After that, for a while, a private github repo did the trick.  With separate directories and files for different projects, I was able to keep my plaintext notes in a way I knew I'd never lose them.  But capturing them was one thing -- using to them was another.  What good is taking notes if you can't easily refer back to them?

I often want to know, when I last met with _X_ (e.g. during a monthly catch-up), what did we talk about?  Or, where are all my notes about topic _Y_ (when _Y_ comes up in the context of lots of different projects)?

So I started to build the Notes program.  I designed it with a few principles in mind.

## Principles

1. Everything must be local.

There are no web services, no hosting, no accounts, no latency, or even needing an internet connection.  I put my `all_notes` directory in my Dropbox, and so I get backups for free (you could do the same with a git repo).  You could in principle put the Notes app on a shared server and use it like a simple wiki, but there is no authentication, security, etc., so you'd have to be operating in a very high trust environment, like a household.

2. Everything has to be ascii.

I personally love [Markdown](https://en.wikipedia.org/wiki/Markdown), the very simple markup language for formatting documents.  I get headings, lists, bold/italic/underline, even simple tables.  But it all remains human readable, unlike other markup languages like HTML.  Even the index, which is just a [json](https://en.wikipedia.org/wiki/JSON) blob, is technically just a text file.

3. Has to be dead simple and fast to use

I'm often in back-to-back meetings 8 hours a day.  For some time, I wouldn't even have time to context switch from one meeting to the next, and would end up with pages and pages of plaintext meeting notes in TextEdit; then I'd have to go back days (or weeks) later and reorganize them.  I need taking a new note to be as simple as clicking 'New' and categorizing a note as simply as typing a `#tag`.  An early part of my career was devoted to [studying tags](https://arxiv.org/abs/cs/0508082) and I love the flexibility of tags to this day. With folders, everything lives in one place in a hierarchy.  With tags, content can live in many places at once.  One of my favorite behaviors is, as I'm taking notes in a meeting, mark something `#todo`.  Then I can go back to all the notes tagged `#todo` and organize those items into a real to-do list.

In addition to tagging notes with conventional `#tags`, you can also tag people, like `@scott_golder`.  People tagging isn't special, it's just a separate tag namespace with some features like autocomplete (no address book integration, e.g.).  Adding tags and people notes makes it easy to navigate to the content you're looking for, or filter (like, "all the documents with `@john_doe` and `#project_x`").

A fact of life in organizations today is slides.  Lots and lots of slides.  I'm always screenshotting slides.  So Notes has functionality to upload image files to notes and embed them in the markdown.  It's not part of markdown, but the simple way to embed an image into a note is writing `<1>`, where _1_ is the index of the uploaded images.

Finally -- perhaps this is feature creep -- hyperlinks.  To link one note to another, write `note:123456`, where _123456_ is the id of the note you're linking to.  Again, not part of markdown, but a pretty simple approach.

4. It has to be easy to find things

Combining filtering by tags, people and time range with full-text search, and I can pretty much find anything I'm looking for fairly quickly.

However, the easiest way to find something is full-text search.  The search capability is fairly rudimentary; it's just a tfidf index.  As noted earlier, the index file is just a json blob.  For really heavy use over a long time, this might get unwieldy and something like sqlite might be better.  This would maintain the principle of "everything must be local" but violate the principle of "everything has to be ascii".

## Conclusion

That's it.  I hope Notes can help others achieve the effectivess that it has helped me to achieve.  Feedback is welcome, as are feature suggestsions or even pull requests.