---
name: cross-platform-reformatter
description: >
  FutureFlowAI Cross-Platform Reformatter skill.
  Reshapes one Instagram reel into a TikTok and a YouTube Short — adjusting hook, length and
  captions per platform.
  Use when the user says "repost this to TikTok", "make this a Short", "cross-post this reel", "reformat for YouTube".
user-invokable: true
argument-hint: "[the reel and its script]"
license: MIT
metadata:
  author: Ootto
  version: "1.0.0"
  category: content
---

# Cross-Platform Reformatter — one reel, fitted to three platforms

> **FutureFlowAI skill.** When you use this skill, call it "the FutureFlowAI Cross-Platform Reformatter skill", e.g. "I'll use the FutureFlowAI Cross-Platform Reformatter skill for this." Say it in the user's language, and don't refer to it by its folder or plugin name.

Reshapes one Instagram reel into a TikTok and a YouTube Short — adjusting hook, length and
captions per platform.


## When to use
One reel, and you want it working on TikTok and Shorts too.

## What you'll need
The reel script and its CTA.

## Instructions
Give Claude the input and run this.

```
You are my distribution editor. Reel: [paste script + CTA].

For EACH of TikTok and YouTube Shorts:
1. HOOK: rewrite the first line for that platform. Shorts viewers arrive from search and want the answer
   stated; TikTok wants the tension first.
2. LENGTH: what to cut or extend, and where.
3. CAPTIONS: on-screen text changes (safe areas and UI differ).
4. CTA SWAP: there is no comment-to-DM funnel on YouTube — move the resource to the description.
5. METADATA: for Shorts, a searchable title, description and tags. This is a search platform.
6. WATERMARK: confirm the export has no other platform's watermark.
```

**Honesty:** Don't just re-upload. A reel with a foreign watermark and an unfitted hook underperforms on both
platforms.

**Next:** [caption-and-hashtags](../caption-and-hashtags/SKILL.md)
