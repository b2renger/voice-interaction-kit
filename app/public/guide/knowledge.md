# Knowledge

The knowledge is what the agent knows, as tables: one table per kind of thing. The artworks of a room, the dishes of a menu, the trains of the day, the plants of a shop. Open it in [Knowledge](view:knowledge).

## Tables, rows and entries

Each row of a table is an **entry**. Its **first cell is how people name it**: "Cappuccino", "Water Lilies", "the 10:42 to Lyon". The other columns are what the agent knows about it: a price, a description, a platform.

| name | description | price |
|---|---|---|
| Espresso | a short, strong coffee | 2 euros |
| `Cappuccino \| cappu` | espresso with milk foam and cocoa | 3 euros |

- **New table** makes one. **Add a row** adds a row, and the **+** at the end of the header adds a column.
- The column names matter: a pattern's line uses them, as in `{price}` (see [Interactions](interactions.md#then)).
- Rename a column by typing in its header; **×** deletes it.

## Other names

Separate other names with `|` in the first cell: `Water Lilies | Nymphéas`. The entry is found by any of them. This matters when people speak another language than the table, or use a nickname.

## Links between tables

A cell that names an entry of another table **links** the two, and shows in blue. The artwork's `artist` cell `Claude Monet` links to the row `Claude Monet` of the artists table: when the agent talks about the artwork, it knows about its artist too.

## From a spreadsheet

**Import a CSV** reads a table exported from Excel, Numbers or Google Sheets (commas, semicolons or tabs; accents are kept). **Export as CSV** gives it back. A table of more than 500 rows shows its first 500 here: edit the rest in a spreadsheet.

A table changed outside the studio, in a spreadsheet or a text editor, shows up when you come back to the studio's window.

## What it would look up

Under the table, type a sentence a person would say. You see the entries the agent would give the language model for it.

The agent doesn't read all its knowledge before each reply. For each sentence, it looks up the entries that matter: the one named, the one in focus (the last one found), and the closest ones. So a table can be long. How it finds them is in [How it decides](decisions.md).
