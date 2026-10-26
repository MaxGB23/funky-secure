# Diagram

`diagram.jpg` is the README artwork: four numbered glass panels in a dark neon palette, deliberately the
same family as the `funky-forge` diagram but with its own material — translucent bevelled panels and a
tube that closes the loop, instead of flat saturated rims.

## Naming

One artwork, one name. `diagram.jpg` is the image the README embeds, and a replacement takes the same
name, so the README never has to change when the drawing does. Alternatives and discarded attempts do
not live in this directory: a numbered suffix in a committed path is how repositories end up with
`diagram2-final-v3.jpg` and nobody able to say which one ships.

## How it was made

The artwork was produced by an image model, not drawn by hand, and then corrected in editing passes. The
method that worked: give the model the sibling product's diagram as a rendering style reference, then
replace its words with this product's in one explicit old-to-new pass, and treat every later correction
as a removal — a repeated line, a leftover label, a duplicated stamp.

Two facts must survive any redraw: every string in the drawing is true of the tool (the twelve rules and
their four families, the exit codes, the commands the plan prints), and the machine appears read-only,
because the tool never installs anything and never reaches the network.
