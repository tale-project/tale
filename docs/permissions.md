# Platform Role-Based Access Control

This document describes the permission system for the Platform service, helping administrators understand the access scope of each role.

## Role Overview

| Role | Description | Intended Users |
|------|-------------|----------------|
| **Admin** | System administrator | Organization owners, IT administrators |
| **Developer** | Technical operator | Engineers, integration developers |
| **Editor** | Content editor | Content managers, customer service leads |
| **Member** | Regular member | General employees, read-only users |
| **Disabled** | Disabled account | Former employees or suspended users |

## Permission Matrix

### AI Chat

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| Create new chat | ✅ | ✅ | ✅ | ✅ |
| Send messages to AI | ✅ | ✅ | ✅ | ✅ |
| View chat history | ✅ | ✅ | ✅ | ✅ |
| Delete/rename chat | ✅ | ✅ | ✅ | ✅ |

> Each user can only see their own AI chat history.

### Knowledge Base

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View documents | ✅ | ✅ | ✅ | ✅ |
| Upload/edit/delete documents | ❌ | ✅ | ✅ | ✅ |
| View products | ✅ | ✅ | ✅ | ✅ |
| Manage products | ❌ | ✅ | ✅ | ✅ |
| View customers | ✅ | ✅ | ✅ | ✅ |
| Manage customers | ❌ | ✅ | ✅ | ✅ |
| View vendors | ✅ | ✅ | ✅ | ✅ |
| Manage vendors | ❌ | ✅ | ✅ | ✅ |
| View websites | ✅ | ✅ | ✅ | ✅ |
| Manage websites | ❌ | ✅ | ✅ | ✅ |
| View tone of voice | ✅ | ✅ | ✅ | ✅ |
| Manage tone of voice | ❌ | ✅ | ✅ | ✅ |

### Conversations (Customer Communication)

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View conversation list | ✅ | ✅ | ✅ | ✅ |
| View conversation details | ✅ | ✅ | ✅ | ✅ |
| Reply to customers | ❌ | ✅ | ✅ | ✅ |
| Close/reopen conversations | ❌ | ✅ | ✅ | ✅ |
| Mark as spam | ❌ | ✅ | ✅ | ✅ |

### Approvals

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View pending approvals | ✅ | ✅ | ✅ | ✅ |
| Approve/reject | ❌ | ✅ | ✅ | ✅ |

### Automations

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View workflow list | ❌ | ❌ | ✅ | ✅ |
| Create/edit workflows | ❌ | ❌ | ✅ | ✅ |
| View execution logs | ❌ | ❌ | ✅ | ✅ |

### Integrations

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View integrations | ✅ | ✅ | ✅ | ✅ |
| Configure email integration | ❌ | ❌ | ✅ | ✅ |
| Configure OneDrive sync | ❌ | ❌ | ✅ | ✅ |
| Manage API integrations | ❌ | ❌ | ✅ | ✅ |

### Organization Management

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| View organization info | ❌ | ❌ | ❌ | ✅ |
| Edit organization settings | ❌ | ❌ | ❌ | ✅ |
| View member list | ❌ | ❌ | ❌ | ✅ |
| Add/remove members | ❌ | ❌ | ❌ | ✅ |
| Change member roles | ❌ | ❌ | ❌ | ✅ |

### Account Settings

| Feature | Member | Editor | Developer | Admin |
|---------|:------:|:------:|:---------:|:-----:|
| Edit personal info | ✅ | ✅ | ✅ | ✅ |
| Change password | ✅ | ✅ | ✅ | ✅ |

## Role Recommendations

### Admin
- Responsible for overall organization management
- Manages team members and permission assignments
- Configures system integrations and automations

### Developer
- Configures and maintains automation workflows
- Manages third-party system integrations
- Has full data access permissions

### Editor
- Manages knowledge base content
- Handles customer conversations and approvals
- Suitable for content operations and customer service teams

### Member
- Uses AI chat to retrieve information
- Views business data (read-only)
- Suitable for employees who need to query information but don't need to edit

## Security Notes

1. **Principle of least privilege**: Assign users the lowest permission role that meets their work requirements
2. **Admin redundancy**: The system requires at least 2 administrators to prevent loss of management access
3. **Self-protection**: Users cannot change their own role; another administrator must make the change
4. **Data isolation**: All data access is restricted to the user's organization scope
