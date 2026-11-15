# Diagram

`diagram.jpg` is the README artwork: four numbered glass panels in a dark neon palette, deliberately the
same family as the `funky-forge` diagram but with its own material — translucent bevelled panels and a
tube that closes the loop, instead of flat saturated rims.

## Naming

One artwork, one name. `diagram.jpg` is the image the README embeds, and a replacement takes the same
name, so the README never has to change when the drawing does. Alternatives and discarded attempts do
not live in this directory: a numbered suffix in a committed path is how repositories end up with
`diagram2-final-v3.jpg` and nobody able to say which one ships.

`diagram-legacy.jpg` is the one exception, and it is not a variant: it is the count-bearing drawing the
redraw replaced, kept because the number that moved is the reason the redraw happened. It never ships
— `files` in `package.json` names `docs/images/diagram.jpg` alone (spec 14.1), and
`scripts/pack-guard.js` refuses any packed path outside that contract, so the tarball carries one image
and the legacy is a repository record.

## How it was made

The artwork was produced by an image model, not drawn by hand, and then corrected in editing passes. The
method that worked: give the model the sibling product's diagram as a rendering style reference, then
replace its words with this product's in one explicit old-to-new pass, and treat every later correction
as a removal — a repeated line, a leftover label, a duplicated stamp.

Two facts must survive any redraw: every string in the drawing is true of the tool (the thirteen rules and
their four families, the exit codes, the commands the plan prints), and the machine appears read-only,
because the tool never installs anything and never reaches the network.

**2026-11-15: the redraw removed the count altogether.** The panel now reads "the stateless rules"
instead of naming how many there are, so the drawing cannot go stale when the catalogue grows again, and
the count lives only in the README sentence the drift gate checks. The count-bearing drawing is kept as
`diagram-legacy.jpg` and does not ship.

Superseded, kept as the reason: on 2026-11-13 this page recorded that the raster still said TWELVE while
the catalogue said thirteen, that RFC 0035 had shipped `workflow-run-artifact` as R13, and that the owner
would redraw it before the release rather than inside that one. This is the redraw, and removing the
number is how the same divergence cannot recur.
