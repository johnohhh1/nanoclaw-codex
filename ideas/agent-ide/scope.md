# Scope

## Problem

Right now Pepper can do meaningful work, but the operator usually has to trust it without a live visual trace of:
- what files it is touching
- what commands it is running
- what browser actions it is taking
- whether it is planning, editing, testing, or stalled

## Goal

Build an operator-facing IDE page where the user can watch an agent run in real time.

## Core user story

When I ask Pepper to build or modify something, I want to open a page and watch:
- what task is active
- what container/session is running
- what commands are being executed
- what output is streaming
- what files changed
- what the current diff looks like

## Non-goals

- not a full VS Code replacement
- not a general-purpose multi-user IDE platform
- not a complex permissions/approval workflow in the first version
- not a perfect replay/debugger before basic observability exists

## Success criteria

- an operator can tell what Pepper is doing without reading only chat
- active runs can be identified quickly
- the system exposes real runtime events, not inferred summaries
