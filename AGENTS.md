# AGENTS.md

## Technology choices

This is a Three.js project with JavaScript source files.
Uses Vite for bundling and eslint for linting.

## Build/Lint Commands

- Build: `npm run build`
- Dev server: `npm run dev`
- Format: `npm run format`
- Lint: `npm run lint`
- Preview: `npm run preview`

Run `npm run format` and `npm run lint` after significant changes to maintain codebase health and consistency.

## Code Style Guidelines

- Follow Standard.js style guide
- Use ES6+ features and modules
- All files use strict mode
- Variable naming: camelCase for variables, PascalCase for constructors
- Imports: Use ES6 import syntax
- Formatting: 2 spaces indentation, semicolons
- Error handling: Try/catch blocks for async operations
- Avoid classes: Do not use classes unless explicitly required by third-party dependencies. Instead, favor simple functions and basic functional programming principles without going deep into functional programming patterns.
- Avoid arrow functions unless explicitly requested or required by some special use case
- Avoid complex and latest JavaScript features, cool tricks, and magic; try to always use simple functions and create simple and straightforward code

## Core Design Principles

All coding implementation in this project must follow these fundamental principles:

### KISS - Keep It Simple, Stupid

Write code that is as simple as possible while still meeting requirements. Avoid unnecessary complexity and favor straightforward solutions.

### DRY - Don't Repeat Yourself

Eliminate duplication in code by creating reusable components, functions, and modules. Every piece of knowledge should have a single, unambiguous representation within the system.

### YAGNI - You Aren't Gonna Need It

Avoid implementing functionality until it's actually needed. Focus on what's required now rather than anticipating future requirements that may never come to pass.

### Avoid Premature Optimization

Don't optimize code before it's necessary. Optimization should only be performed when there's a proven performance bottleneck. Follow the principle: "Make it work, make it right, make it fast - in that order." Premature optimization can lead to complex, hard-to-maintain code without measurable benefits.

## Performance Notes for Realtime 3D Code

This is a browser-based Three.js game. Small inefficiencies inside per-frame loops can become visible as stutter, especially during chunk streaming, terrain remeshing, particles, and LOD updates.
When changing performance-sensitive systems, follow these rules:

- Avoid allocating objects inside per-frame loops. Reuse `THREE.Vector3`, arrays, temporary objects, and typed arrays where practical.
- Do not call `.clone()` in hot paths such as particle updates, raycasts, physics, terrain checks, LOD visibility, or chunk streaming. Prefer `temp.copy(value)` or write into an `out` parameter.
- Avoid creating or destroying Three.js objects during gameplay unless necessary. Prefer fixed pools for particles, projectiles, lights, temporary effects, and repeated visual elements.
- Do not create new `Geometry`, `Material`, `Texture`, `CanvasTexture`, `Audio`, or DOM elements per frame.
- If a system updates many objects, use one shared `BufferGeometry`, `InstancedMesh`, or pooled meshes where possible.
- Throttle expensive visibility, sorting, scanning, and ownership logic. These usually do not need to run at 60 FPS.
- Keep hard per-frame budgets for chunk mesh application, dirty remeshing, voxel edits, chunk unloads, and other terrain work.
- Prioritize near/player-critical work over far visual work. Full nearby chunks and collision-critical remeshing must win over mid/far LOD generation.
- Avoid sorting large lists every frame. Cache, throttle, or use partial selection when possible.
- Avoid linear duplicate checks like `array.includes(key)` in frequently updated queues. Use a companion `Set` for membership.
- Always dispose of Three.js resources when removing long-lived systems: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, and remove objects from the scene.
- Visual effects must not modify gameplay state unless explicitly intended. Camera shake, idle motion, RCS flames, wind particles, and similar effects should usually be render-only.
- Keep debug overlays, logs, wireframes, and visualization modes disabled by default in release builds.
- After performance-sensitive changes, test by flying for several minutes while watching FPS and memory. Look for stutter, steady memory growth, and delayed chunk/LOD updates.

## Testing Policy

This project intentionally does not include any tests, test frameworks, or test-related tooling. The development approach focuses on:

1. **Manual testing** through the interactive 3D visualization
2. **Code reviews** to ensure quality and correctness
3. **Simple, readable code** that is self-documenting
4. **Incremental development** with frequent manual verification

The absence of tests is a deliberate architectural decision to:

- Reduce project complexity
- Minimize maintenance overhead
- Allow rapid iteration on visual and interactive features
- Focus development effort on the core 3D functionality

All code should be written with clarity and simplicity as the primary goals, making it easily understandable without the need for test documentation.

## Skills

Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
No skills are currently available.
