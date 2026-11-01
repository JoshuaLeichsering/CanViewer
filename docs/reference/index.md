# Reference

Facts about what CanViewer reads and how, for when the [guide](../guide/index.md) is not
precise enough.

- [Formats and fidelity](./formats.md): for every format read through canmatrix, how
  many test files it reads and how what it reads differs from the same database in DBC;
  and what canmatrix's DBC reader would change on 58 real-world DBC files.
- [Supported DBC statements](./dbc.md): what CanViewer's DBC parser models, what it
  recognizes and skips, and the corpus it is tested against.
- [Deep links](./deep-links.md): the forms of the `#…` part of the app's address.

The tables on these pages are generated from the pinned test baselines by
[`scripts/docs/fidelity-tables.mjs`](../../scripts/docs/fidelity-tables.mjs), and a
test fails when a page and the baselines disagree. They change only when the readers'
behaviour changes, and then in the same change.
