# OneDrive Parent Directory Tracking

## Overview

This feature enhances the OneDrive sync functionality to track whether files were directly selected by the user or synchronized from a parent directory. When files are synced from a folder, the system now records which parent directory was originally selected by the user.

## New Metadata Fields

When files are synced to Supabase storage, the following new metadata fields are now included:

### Core Selection Tracking
- `isDirectlySelected` (boolean): Whether the file was directly selected by the user
- `syncType` (string): Either "direct" or "folder" (existing field, enhanced)

### Parent Directory Information
- `selectedParentId` (string): OneDrive ID of the parent directory that was directly selected
- `selectedParentName` (string): Name of the parent directory that was directly selected  
- `selectedParentPath` (string): Path of the parent directory that was directly selected

## Use Cases

### Scenario 1: Direct File Selection
When a user directly selects individual files:
```json
{
  "isDirectlySelected": true,
  "syncType": "direct",
  "selectedParentId": null,
  "selectedParentName": null,
  "selectedParentPath": null
}
```

### Scenario 2: Folder Selection
When a user selects a folder named "Documents" containing subfolders and files:
```json
{
  "isDirectlySelected": false,
  "syncType": "folder",
  "selectedParentId": "folder-abc123",
  "selectedParentName": "Documents",
  "selectedParentPath": "Documents"
}
```

### Scenario 3: Nested Folder Structure
For a file at `Documents/Projects/2024/report.pdf` where "Documents" was selected:
```json
{
  "isDirectlySelected": false,
  "syncType": "folder",
  "selectedParentId": "folder-abc123",
  "selectedParentName": "Documents", 
  "selectedParentPath": "Documents",
  "relativePath": "Documents/Projects/2024"
}
```

## Benefits

1. **Traceability**: Users can identify which parent directory they originally selected
2. **Organization**: Better understanding of file origins in storage
3. **Debugging**: Easier troubleshooting of sync operations
4. **User Experience**: Clear indication of how files were synchronized

## Implementation Details

### Frontend Changes
- Enhanced `collectAllFiles` function to track selected parent information
- Updated sync handler to pass selection context
- Modified file processing to include parent directory metadata

### Backend Changes  
- Updated API route to accept and process parent directory information
- Enhanced storage metadata with new fields
- Updated type definitions across the codebase

### Database Schema
The metadata is stored in Supabase storage's `user_metadata` field as JSON:
```sql
-- Example storage object metadata
{
  "oneDriveId": "file-123",
  "oneDriveName": "document.pdf",
  "source": "onedrive",
  "syncType": "folder",
  "isDirectlySelected": false,
  "selectedParentId": "folder-abc123",
  "selectedParentName": "Documents",
  "selectedParentPath": "Documents",
  "syncedAt": "2024-01-15T12:00:00Z"
}
```

## Backward Compatibility

- Existing synced files without the new metadata fields will continue to work
- New fields are optional and won't break existing functionality
- Legacy files can be identified by the absence of `isDirectlySelected` field

## Future Enhancements

- UI indicators showing file selection source
- Filtering capabilities based on selection type
- Bulk operations on files from specific parent directories
- Analytics on user selection patterns
