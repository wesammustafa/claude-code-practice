1: subagents because three independent reviews run once and only a short list of suspects comes back
2: workflow because it covers the whole codebase, every finding is confirmed before it is listed, and it runs again for every release
3: main conversation because the rename, its 40 small edits and the build share one context that must stay consistent
4: subagents because each suspect is checked on its own and only the results come back for me to weigh
5: /batch because the migration splits into packages that each build, test and land on their own, one worktree each
