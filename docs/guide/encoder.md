# Encoding frames

The frame encoder is the inverse of the [decoder](./decoding.md): you enter a physical
value for each signal of a message, and it gives the frame's bytes in hex. It is the
**Encode frame** card on every [message page](./messages.md#the-message-page).

![The encoder card of EngineData in examples/demo.dbc](./images/encoder-en-light.webp#gh-light-mode-only)
![The encoder card of EngineData in examples/demo.dbc](./images/encoder-en-dark.webp#gh-dark-mode-only)

## Entering values

- One field per signal, in the signal's unit. A field you leave empty keeps the value
  shown in grey, which is what the frame holds for that signal now.
- For a signal with value descriptions, a list lets you pick a description instead of
  typing its value.
- **Encoded frame** shows the bytes as you type. **Copy** copies them.
- Bits without a value are 0. **From decoder** starts from the frame in the decoder
  instead, so that you can change one signal of a frame you have; **Reset** starts
  over.
- **Decode** shows the encoded frame in the decoder, signal by signal.

In a multiplexed message, a multiplexed signal counts only when the multiplexor values
you entered select it; the others are marked *mux inactive*.

## When a value does not fit

The encoder never changes a value behind your back. The frame is decoded again after
every change, and each field says when the frame does not hold what you typed:

- *Not a number*, when the field cannot be read;
- *Out of range*, with the range the signal's bits can hold: the value is not encoded,
  not clamped;
- *Outside the n-byte data area*, for a signal that runs past the end of the frame;
- *Overwritten by an overlapping signal*, when another signal shares its bits;
- *encodes as …*, when the signal's resolution rounds the value, with the value the frame
  holds;
- a warning, *Outside the database range*, when the value fits the bits but lies
  outside the minimum and maximum the database gives.

When any of this happens, the card also says that the frame does not hold every value
as entered.

## How it is checked

For every one of the 58 real-world DBC files CanViewer is tested against, every signal,
and sampled whole frames, are encoded and decoded again, and must come back as entered.
