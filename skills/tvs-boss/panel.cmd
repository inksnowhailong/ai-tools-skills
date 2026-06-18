@echo off
rem ============================================================
rem  tvs-boss panel one-click launcher (double-click to open)
rem  Why: skip the "cd to team root, then type node ..." steps.
rem  Self-contained: locate script via %~dp0, pass --root explicitly,
rem  so it does NOT depend on the cwd when double-clicked.
rem  NOTE: keep this file ASCII-only. cmd.exe parses the batch
rem  bytes with the OEM codepage before chcp runs; non-ASCII
rem  comments/echo would be mis-read as commands.
rem ============================================================

rem UTF-8 codepage so the spawned TUI shows CJK / box-drawing correctly
chcp 65001 >nul

title tvs-boss panel
set "PANEL=%~dp0scripts\panel.mjs"

rem Pass team root E:\ (contains .tvs-boss/) explicitly -> works from anywhere
node "%PANEL%" --root "E:\"

rem On error, keep the window open so the cause is visible; clean exit (0) closes
if errorlevel 1 (
  echo.
  echo [tvs-boss] panel exited with error %errorlevel%. Common causes: node not installed, or E:\.tvs-boss missing.
  pause
)
