# Claude Code Instructions

## Working Directory
- **Always work on the main repo:** `/Users/manuchermehraein/Documents/Cursor/patient-intake-2/`
- Never make changes in worktree branches (e.g. `.claude/worktrees/`). If a worktree is active, apply all changes to the main repo path above instead.

## Git & Deployment
- After completing changes, commit to the **main** branch on GitHub.
- After committing, deploy to **Azure**.
- **Azure deployment is automatic:** pushing to `main` triggers GitHub Actions (`.github/workflows/main_healt-assist-ai-prod.yml`), which builds and deploys to Azure Web App `healt-assist-ai-prod`. No manual deploy command needed — `git push origin main` is the deploy step.
