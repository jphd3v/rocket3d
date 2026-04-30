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
