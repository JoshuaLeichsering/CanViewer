# Value tables

**Tables** in the navigation rail lists the database's named value tables
(`VAL_TABLE_`), each with its number of entries.

![The value table GearPositions of examples/demo.dbc](./images/tables-en-light.webp#gh-light-mode-only)
![The value table GearPositions of examples/demo.dbc](./images/tables-en-dark.webp#gh-dark-mode-only)

A table's page lists its entries, raw value (in decimal and hex) and meaning, and under
*Same values used by* the signals whose value descriptions are identical to it.

The DBC format does not record which signal uses which value table: a signal carries
its own copy of the descriptions (`VAL_`). Signals with exactly the same descriptions
are therefore the best available answer, and that is what the list shows.

The destination is greyed out in the rail when the database has no value tables.
