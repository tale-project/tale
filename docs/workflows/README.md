# Workflow System Documentation

Welcome to the Workflow System documentation. This directory contains comprehensive guides for understanding, configuring, and using the workflow system.

---

## 📚 Documentation Index

### Core Documentation

- **[Architecture Guide](./architecture.md)** ⭐
  System architecture, data model, and technical design of the workflow system.
  _Start here to understand how the system works._

- **[Developer Guide](./developer-guide.md)**
  Comprehensive developer guide covering the workflow module implementation, APIs, node types, and execution engines.
  _Essential reading for developers working with the workflow system._

- **[Data Specification](./data-spec.md)**
  Canonical data model and conventions used by the workflow engine, including variable structure and step outputs.
  _Reference for understanding workflow data flow and variable access patterns._

- **[Database Operations](./database-operations.md)**
  Specialized database operations for workflows, organized by entity type with Convex best practices.
  _Guide for implementing safe database operations in workflow actions._

- **[Manual Configuration](./manual-configuration.md)**
  Execute workflows using JSON configuration directly, bypassing database-stored definitions.
  _Useful for testing, prototyping, and one-off executions._

---

## 🚀 Quick Start

### I want to...

**Understand the system architecture:**
→ Read [Architecture Guide](./architecture.md)

**Learn the workflow module implementation:**
→ Read [Developer Guide](./developer-guide.md)

**Understand workflow data model and variables:**
→ Read [Data Specification](./data-spec.md)

**Implement database operations in workflows:**
→ Read [Database Operations](./database-operations.md)

**Test workflows with custom configuration:**
→ Read [Manual Configuration](./manual-configuration.md)

---

## 📖 Key Concepts

### Workflow System Overview

The workflow system is built on Convex and uses a clear separation between:

- **Definition Layer**: Workflow templates and step configurations (stored in `wfDefinitions` and `wfStepDefs` tables)
- **Execution Layer**: Runtime execution powered by the `@convex-dev/workflow` component
- **Approval Layer**: Human-in-the-loop approval tasks (stored in `approvals` table)

### Core Tables

- **wfDefinitions**: Workflow templates/definitions (UI-editable)
- **wfStepDefs**: Step definitions and configuration (UI-editable)
- **wfExecutions**: Execution instances and status (authoritative view)
- **approvals**: Approval work items (unified human-in-the-loop tasks)

### Key Features

- ✅ Visual workflow design
- ✅ Sequential and conditional execution
- ✅ Human approval steps with suspend/resume
- ✅ Manual and scheduled (cron) triggers
- ✅ Complete execution logging and audit trail
- ✅ Manual configuration for testing

---

## 🔧 System Architecture

The workflow system uses a **dual-layer architecture**:

1. **Our Definition Layer** (UI-editable tables with `wf*` prefix)

   - Stores workflow templates and configurations
   - Provides the user-facing API
   - Manages approval tasks and audit logs

2. **Convex Workflow Component** (execution engine)
   - Handles runtime execution
   - Manages step scheduling and state
   - Provides reliability and error handling

This separation ensures:

- No table name collisions
- Clear responsibility boundaries
- Flexibility to update definitions without affecting running executions

---

## 📝 Document Maintenance

### Guidelines

- Keep documentation focused on the **current system state**
- Avoid documenting development processes, optimizations, or refactoring history
- Update all relevant documents when making system changes
- Use clear, descriptive names (avoid terms like "optimization", "refactor", "mvp")

### When to Update

Update documentation when:

- Adding new features or capabilities
- Changing system architecture or data models
- Modifying APIs or user interfaces
- Discovering best practices or common patterns

---

## 🆘 Getting Help

If you need help with the workflow system:

1. Check the relevant documentation guide above
2. Review the architecture guide for system design questions
3. Look at the manual configuration guide for testing approaches

---

## 📌 Related Documentation

For documentation outside the workflow system, see the main [docs](../) directory:

- Integration guides (OneDrive, email providers, etc.)
- Deployment guides (Convex, Tale DB, Tale Operator, Tale RAG)
- Security guides (Row-level security)
- Management dashboard user guide
