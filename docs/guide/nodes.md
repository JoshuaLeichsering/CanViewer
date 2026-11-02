# Nodes

**Nodes** in the navigation rail lists the ECUs the database declares (`BU_`), each with
its comment and how many messages it transmits (`tx`) and signals it receives (`rx`).

![The node ECM of examples/demo.dbc](./images/nodes-en-light.webp#gh-light-mode-only)
![The node ECM of examples/demo.dbc](./images/nodes-en-dark.webp#gh-dark-mode-only)

A node's page shows:

- its comment, the number of messages it transmits and signals it receives, and its
  attribute values (above, `NodeAddress`);
- **Transmitted messages**: every message the node sends, as the sender of `BO_` or as an
  additional transmitter from `BO_TX_BU_`, with ID, DLC, number of signals and cycle
  time;
- **Received signals**: every signal that names the node as a receiver, with the message
  it is in, its unit and the node that sends it.

Click a message or a signal to open it. The destination is greyed out in the rail when
the database declares no nodes.
