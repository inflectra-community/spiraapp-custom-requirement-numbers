# Custom Requirements Numbering

Copyright Inmarsys Limited. Licensed under the **Inmarsys Non-Resale
License 1.0** - full text in `LICENSE`. In short: free to use, modify,
distribute, and host, including within commercial organisations, and
free to charge for installation/support/hosting services around it -
just not to sell the Software itself (or a rebadged/modified copy of it)
as a standalone product, and the Inmarsys copyright notice must stay
intact. 

A SpiraApp for SpiraTeam / SpiraPlan 9.4.0.0+ that assigns project-unique,
prefix-based numbers to Requirements, based on their type, and can
optionally copy that number into the requirement's Name.

This is the first implementation of the SpiraApp and therefore may have bugs.
A feedback is appreciated.

## General note - warranty
- The code is AI-generated and therefore may have issues. It was tested by
human but not formally, therefore no warranty is given or implied.
- See `LICENSE` for specific warranty definitions

## Compliance note - why this version looks the way it does

An earlier version of this SpiraApp rendered its own admin settings page
with custom JavaScript (raw DOM manipulation). Inflectra confirmed
directly, in writing, that this does not meet their SpiraApp publication
standards - fine for a private, customer-specific install, not for
marketplace publication.

**This version has no custom admin page, no DOM access, and no REST API
calls anywhere.** Every configurable setting - including up to 20
Requirement Type / Prefix pairs - is a native `productSetting`, declared
in `manifest.yaml`. Spira renders, saves, and persists all of them
automatically. Two earlier designs for the Type-to-prefix mapping
specifically were tried and abandoned along the way (an admin-typed
Custom List name, then a Custom List wrapped in a hidden custom property)
- see the comment block at the top of `requirementDetails.js` for why,
kept there in case that history is useful again someday. This version
sidesteps the problem those ran into entirely: there is no extra field on
the requirement form at all, so there is nothing to hide.

## How it works

- The admin configures up to **20 Requirement Type / Prefix pairs** in
  this SpiraApp's own settings - each pair is a native dropdown (pick a
  Requirement Type) plus a plain text box (its prefix). A type left
  unconfigured, or given an empty prefix, gets `N/A` and is never
  numbered.
- If the **same** Requirement Type is accidentally selected in more than
  one pair, the **first** pair (lowest number) wins; the later one is
  silently ignored.
- When a user saves a Requirement, the SpiraApp looks up the
  requirement's type against those pairs and writes `<PREFIX><4-digit
  number>` into a chosen custom property (the "Requirement Number Field",
  RNF), e.g. `SWFR0007`. The number is never reused, even after deletion.
  Numbers are capped at 9999 per prefix, fixed - not admin-configurable.
- If a requirement's type is changed to one with a different prefix, a
  fresh number is drawn from the new prefix's counter; the old prefix's
  counter is left exactly where it was.
- Optionally, the requirement's Name is kept identical to its generated 
  Prefix/Number value.
- If **requirements' prefix shall be the same across the project** then 
  use the same prefix for all requirement types.
- **Note**: changing a prefix will not lead to automatic renumbering of
  requirements. The requirements will stay in exact same state they were
  prior to the change. To bring the requirements numbers to the right state,
  open each requirement and save it again; then   the requirement will be
  updated with the new prefix/number

## Configuration

All settings live in this SpiraApp's native Settings section (Product
Admin > General Settings > SpiraApps > Custom Requirements Numbering),
and save via that section's single native Save button - there is nothing
else to configure anywhere else, and no other page has any script on it.

| Setting | Notes |
|---|---|
| Requirement Number Custom Property | Native dropdown of the project's Requirement custom properties. Pick a **Text** one. Set it read-only in the workflow to stop users editing it by hand. |
| Substitute Name for Requirement Number | When ticked, Name is overwritten with the Custom Requirement Number value on every save. |
| Requirement Type 1..20 / Prefix 1..20 | Under "Type Prefixes" further down the same page. Each numbered pair: pick a Requirement Type from its native dropdown, type its prefix next to it. Leave a pair's Type unset, or its Prefix blank, to skip it. You don't need to fill all 20 - stop once you've covered every type you want numbered. |

## Troubleshooting

**My requirement isn't getting a number - the field stays blank/unchanged.**
The SpiraApp isn't running for this requirement at all. Check that
**Requirement Number Custom Property** has actually been selected and
saved. If it's still "--- Please Select ---", nothing will happen on any
save, by design.

**My requirement's number field shows "N/A" instead of a number.**
The SpiraApp ran, but found no matching Type/Prefix pair for this
requirement's type. Check:

1. Is there a pair (1 through 20) whose Type dropdown is actually set to
   this requirement's type?
2. Does that same pair's Prefix box actually have something typed in it?
   A Type selected with no Prefix counts as no entry at all.
3. If you meant to change a prefix and it's not taking effect: check
   whether the same Type got accidentally selected in an *earlier*-
   numbered pair too - the earlier one always wins, so the later edit is
   being silently ignored. Search all 20 pairs for that Type, not just
   the one you just edited.

## Known limitations

- **No server-side atomic increment.** Counters are read, incremented,
  and written back from the browser with no locking. Two users saving a
  requirement under the same prefix at nearly the same moment could
  theoretically draw the same number. Flag this if a project is expected
  to have many people saving requirements concurrently.
- **Maximum 9999 requirements per prefix, fixed.** Not configurable. A prefix that hits this
  limit gets N/A on every further save until Inmarsys makes a code
  change - there is deliberately no admin-facing way to raise it.
- **20 Type/Prefix pairs, fixed.** A project needing more than 20
  Requirement types numbered this way is out of scope by design.

## After every deploy - one required step

**Visit the admin settings page once (Product Admin > General Settings >
SpiraApps > Custom Requirements Numbering) after every install or
update, even if nothing needs changing, before testing or using the
SpiraApp.** Confirmed necessary - a fresh install/update doesn't reliably
take effect on the Requirement Details page's script until the admin
page has been opened at least once afterward. No save is needed, opening
the page is enough. Root cause not confirmed (possibly a settings cache
that only refreshes on that page's own load), but the behaviour itself is
confirmed and repeatable, so treat it as a required step, not optional.

- **Developer Mode's Delete-then-Install resets everything.** Deleting
  and reinstalling the SpiraApp - even with an unchanged manifest GUID -
  loses native settings and this SpiraApp's own Storage data, because
  Spira's internal `pluginId` increments on every Delete+Install even
  though the GUID doesn't change. **Use Update (re-upload a revised
  package over the still-installed app) while iterating** - that keeps
  the same `pluginId` and preserves everything. Reserve Delete+Install
  for a genuine clean slate.
