# content-skills

Content and social media skills: from idea and research to reel script, hooks, carousels, captions, planning and following up on comments.

## Origin

A copy of [Ootto-AI/claude-content-skills](https://github.com/Ootto-AI/claude-content-skills) (MIT, © 2026 Ootto), version 1.4.0, commit `c79c330`, taken over on 2026-10-18. We adapt the skills here ourselves; upstream updates are not pulled in automatically. The original README is in [UPSTREAM-README.md](UPSTREAM-README.md) and the license in [LICENSE](LICENSE).

The `agent-reach` skill is in turn taken from [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) (MIT). It relies on external command-line tools (such as `agent-reach`, `yt-dlp` and `opencli`) that you install yourself, and some platforms need your browser cookies.

## FutureFlowAI branding

Every skill's description starts with "FutureFlowAI <Name> skill." and a note under the title tells Claude to announce it that way ("I'll use the FutureFlowAI Content Repurposer skill for this.") instead of by its folder name. Keep both when adding or updating a skill.

## Install

```bash
claude plugin install content-skills@futureflowai-mods
```

If you also have the original (`claude-content-skills`) installed, uninstall it: the skills share the same names and would otherwise load twice.
