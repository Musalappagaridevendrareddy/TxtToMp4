# Voice consent

IndexTTS-2 can clone a voice from a few seconds of reference audio. That is a
capability with an obvious misuse, so this package will not do it on trust.

## The rule the code enforces

`IndexTTS2Engine` refuses to start if `reference_audio` points at a file that has
no `consent.json` next to it. The check runs *before* the model loads, so a
missing record fails immediately.

```
voices/
  jane.wav
  consent.json      <- required, same directory
```

`consent.json` must record **who** consented and **when**:

```json
{
  "speaker": "Jane Doe",
  "consented_at": "2026-08-15",
  "scope": "explainer narration for the internal product channel",
  "contact": "jane@example.com",
  "revocable": "on request, by emailing the contact above"
}
```

Accepted keys for *who*: `speaker`, `consented_by`, `who`.
Accepted keys for *when*: `consented_at`, `date`, `when`.
Anything else in the file is kept and ignored — add whatever your legal process
needs. A record that names no person or no date is rejected: a consent record
that does not say who and when is not a consent record.

## Synthetic voices

No reference audio means no cloned human, so no consent file is required. Leave
`reference_audio` unset (and `INDEXTTS2_REFERENCE_AUDIO` unexported) to use a
built-in synthetic voice. Kokoro's voices are synthetic; it has no consent gate.

## What this is not

The check is a speed bump against carelessness, not a legal review. It proves a
file exists; it cannot prove the person in the recording agreed. If you did not
personally obtain the consent, do not write the file.
