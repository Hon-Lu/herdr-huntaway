# huntaway-custom

My own setup: the huntaway layout plus mods other people made. It is for me (at home and at
work) and anyone I hand it to; it is not shared on herdr.dev. Installing huntaway from herdr.dev
or the main README never touches this folder.

## Install

From a clone of this repository, in PowerShell:

```powershell
.\install.ps1 -Custom
```

It installs huntaway and its mods, fetches each mod in `mods.json` at its pinned commit, copies
`layouts/huntaway-custom.json` and switches to it. Run it again after `git pull` to update.
For `Ctrl+Shift+N`, add `keys.json` to `~/.config/herdr-app/keys.json` (the same shortcut as
huntaway's, for this layout's name).

## Adding a mod

1. Add an entry to `mods.json`:

   ```json
   {
     "name": "run-scripts",
     "repo": "https://github.com/<owner>/<repo>",
     "commit": "<full commit hash>",
     "path": "run-scripts/mods/run-scripts",
     "license": "MIT",
     "needs": "what else it needs, if anything"
   }
   ```

   `name` is the folder it gets in `~/.config/herdr-app/mods/` and the name the layout uses;
   `path` is the mod's folder inside that repository. Pin a commit, never a branch.
2. Put it in `layouts/huntaway-custom.json` (a block, a stack child or a floating spot).
3. Run `.\install.ps1 -Custom`.

## Mods in it

None yet: the layout is huntaway's as it is.

## Keep in mind

- `layouts/huntaway-custom.json` started as a copy of `huntaway/layouts/huntaway.json`. When the
  huntaway layout changes, bring the change over by hand.
- Other people's mods are fetched, never copied into this repository.
- This folder has no `RECIPE.md` and no `preview.png`, so herdr.dev doesn't list it. Keep it so.
