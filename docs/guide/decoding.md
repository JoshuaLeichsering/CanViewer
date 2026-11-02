# Decoding frames

Every message page has a **Decode frame** card. Enter the bytes of a frame as you see
them in a trace or a bus monitor, and CanViewer shows each signal's physical value.

![EngineData decoded from E0 2E 82 3C 90 81 0C 01: 3000 rpm, 90 degC, 24 %](./images/decoder-en-light.webp#gh-light-mode-only)
![EngineData decoded from E0 2E 82 3C 90 81 0C 01: 3000 rpm, 90 degC, 24 %](./images/decoder-en-dark.webp#gh-dark-mode-only)

## Entering bytes

- Write the bytes in hex, in the order they are on the bus: `E0 2E 82 3C`, `0xE0,0x2E`
  and `E02E823C` all mean the same.
- Every byte needs both digits. Input that is not whole hex bytes is marked invalid.
- Fewer bytes than the message's DLC are padded with zeros; bytes beyond the DLC are
  ignored. The card echoes the bytes it used when they differ from what you typed.
- An empty field decodes as all zeros.
- Switching to another message clears the field, so old bytes never decode into a
  message they do not belong to.

## Reading the result

Each signal gets one line: its name, its physical value with unit, and the value
description when the raw value has one (above, `EngineRunning` is `1`, described as
*Running*). Click a line to select the signal; its card then marks the matching value
description.

The physical value is `raw × factor + offset`, with the raw value read from the signal's
bits in its byte order, as unsigned or signed (two's complement) integer, or as IEEE 754
float or double for `SIG_VALTYPE_` signals.

## Multiplexed messages

A multiplexed message carries different signals depending on the value of its
multiplexor. The decoder reads the multiplexor first. Signals whose switch value does
not match are still decoded, but marked *mux inactive*. With extended multiplexing, a
signal is active only when its whole chain of switches is.

## The other way round, and many frames

- The [frame encoder](./encoder.md) does the inverse: you enter physical values, and it
  gives the frame's bytes. **Decode** in the encoder shows its frame here, and **From
  decoder** starts the encoder from the frame decoded here.
- The [Traces view](./traces.md) decodes every frame of a log file recorded from a bus.

## Limits

- The decoder decodes one frame at a time, typed or pasted by you. It does not connect
  to a bus; for a log file, use the [Traces view](./traces.md).
- Decoding is plain arithmetic in your browser. Nothing is sent anywhere.
