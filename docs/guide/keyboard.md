# Keyboard

Every view of CanViewer works from the keyboard. Tab and Shift+Tab move through the
controls of a page, and Enter or Space activates the one with the focus. A few keys do
more.

## Anywhere

| Key | What it does |
|---|---|
| `/` | Goes to **Messages** and focuses the search, from any view. It does nothing while you type in a text field. With the settings menu open, it closes the menu first |
| Escape | Closes the open menu or dialog; the focus returns to the button that opened it |

The search field shows a `/` hint at its right end where the whole placeholder fits
beside it; on touch devices it never shows.

## Lists

In the lists of **Messages**, **Nodes** and **Tables**:

| Key | What it does |
|---|---|
| ↓, ↑ | Shows the next or the previous item |
| Home, End | Shows the first or the last item |
| ↑ on the first message | Goes back to the search field |

From the message search, ↓ goes to the selected message, or to the first match, and
Enter opens it. In a [large database](./messages.md#the-message-list) the list renders
only the rows in view; the keys work all the same, and a row with the focus keeps it
while it scrolls out of view.

Rows of the tables on a page, such as the messages on the [overview](./overview.md), the
messages and signals of a [node](./nodes.md) and the [signal table](./messages.md#the-signal-table),
take the focus with Tab. Enter or Space opens the row's message, or selects its signal.

## On a page

- **Signal table**: every column header is a button that sorts by its column. In the
  filter row, Escape clears the field that has the focus.
- **Network graph**: Tab reaches every node; Enter or Space selects it and lists its
  connections.
- **Clusters** of an [imported file](./import.md#what-you-get): the arrow keys move to
  the previous or next cluster and show it.
- **Traces**: the frame table takes the focus with Tab. ↑ and ↓ select the previous or
  next frame, Page Up and Page Down move a screen at a time, and Home and End go to the
  first and the last frame.
- **Menus** (the settings menu and **Export**): ↑, ↓, Home and End move between the
  items, Escape closes the menu, and Tab leaves it.
- **Dialogs** (the editors and the questions before saving or discarding edits): the
  focus starts in the dialog and stays there while it is open; Escape cancels.

## Narrow windows

Below 840 px the list and the page take turns on screen instead of standing side by
side, and the focus moves with them: to the page's back button, or to the selected item
of the list. Below 600 px, phone width, the navigation rail becomes a navigation bar at
the bottom, with the menu, open file and theme buttons in a bar at the top; Tab goes
through the top bar first, then the navigation bar, then the content.

## When something goes wrong

The [recovery screen](./opening-files.md#if-canviewer-fails) takes the focus when it
appears, so Tab goes straight to **Reset stored file** and **Reload**.
