# Wedding Invitation

A digital wedding invitation that opens like a theatre: guests tap the wax seal, the red curtains open, the couple's names appear, they scratch gold circles to reveal the date, and then scroll through the countdown, events, map, menu, dress code and more. Made for phones first, with an English / বাংলা switch.

- **Invitation:** `https://<your-username>.github.io/<repo-name>/`
- **Editor:** `https://<your-username>.github.io/<repo-name>/admin.html`

## Editing (no coding)

Open the editor link on your phone or laptop.

1. **Setup tab:** enter your GitHub username, the repository name and an access token (steps below). You do this once per device.
2. **Edit tab:** tap any section and change the text. The preview updates as you type.
3. Press **Publish**. Everyone with the link sees the new version in about a minute.

Everything is editable: names, events, dates, times, venues, map links, colours (6 ready themes or any colour you like), music, photo, menu, dress code, gifts, RSVP, closing note, the order of sections, and the picture shown when the link is shared on WhatsApp or Facebook. Every section has an on / off switch. You can also add your own extra sections.

### Getting a token (2 minutes)

1. Go to <https://github.com/settings/personal-access-tokens/new>
2. Name it `wedding editor`, set the expiry to a date after the wedding.
3. Repository access: **Only select repositories** and pick this repository.
4. Repository permissions: **Contents → Read and write**.
5. Generate, copy, and paste it in the editor's Setup tab.

The token is saved only on that device. Don't share it.

## Sending invitations

The **Guest links** tab makes a personal link for each guest. Their name appears on the curtain ("Dear Rahim Uncle, you are invited") and is filled into the RSVP form. Each link has a WhatsApp button that opens a ready-to-send message.

You can also add `?to=Name` to the link yourself, for example `…/?to=Nadia+Apu`, and `&lang=bn` to open it in Bangla.

## Files

| File | What it is |
| --- | --- |
| `content.json` | All your text and settings. The editor changes this file. |
| `index.html` | The invitation page. |
| `admin.html` | The editor. |
| `assets/js/app.js` | Draws the invitation from `content.json`. |
| `assets/js/admin.js` | The editor's logic and the GitHub publishing. |
| `assets/js/shared.js` | Shared helpers: curtain drawing, dates, Bangla numbers, ornaments. |
| `assets/css/` | Styles for the invitation and the editor. |
| `assets/fonts/` | Pinyon Script, Cormorant Garamond, Galada, Noto Serif Bengali (SIL Open Font License). |
| `assets/music/` | Default music: a music-box arrangement of Pachelbel's Canon (public domain). |
| `assets/uploads/` | Photos and songs you upload from the editor. |

## Notes

- GitHub Pages on a free account needs the repository to be **public**, so anyone could find `content.json`. Don't put anything private in the invitation. The pages ask search engines not to list them.
- After publishing, a phone that already had the page open may need a refresh to see the change.
- WhatsApp and Facebook keep link previews for a while, so a new preview picture can take time to show for links that were already shared.
