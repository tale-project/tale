# OneDrive Integration Debugging Guide

## Overview

This guide explains how to debug "item not found" errors and other issues in the OneDrive integration. The debugging system provides detailed logging and error tracking to help identify root causes.

## Potential Causes of "Item Not Found" Error

### 1. File/Folder Deletion
- **Cause**: Items were deleted after being listed but before being accessed
- **Symptoms**: Error occurs when clicking on specific files/folders
- **Debug Info**: Check the debug logs for the specific file ID and name

### 2. Permission Changes
- **Cause**: User permissions changed between listing and accessing files
- **Symptoms**: Intermittent access issues, especially in shared folders
- **Debug Info**: Look for 403 Forbidden errors in the logs

### 3. Invalid File IDs
- **Cause**: File/folder IDs became invalid due to OneDrive sync issues
- **Symptoms**: Consistent errors for specific items
- **Debug Info**: Compare file IDs between different API calls

### 4. Token Expiration
- **Cause**: Microsoft access token expired during the session
- **Symptoms**: Authentication errors, "session has expired" messages
- **Debug Info**: Check for token expiration errors in logs

### 5. Race Conditions
- **Cause**: Multiple requests trying to access the same item simultaneously
- **Symptoms**: Sporadic errors, especially during rapid navigation
- **Debug Info**: Look for overlapping API calls in the logs

### 6. OneDrive Sync Issues
- **Cause**: Items not properly synced between OneDrive and Graph API
- **Symptoms**: Files visible in OneDrive web but not accessible via API
- **Debug Info**: Check for 404 errors with valid-looking file IDs

## Debug Panel Features

### Development Mode Only
The debug panel only appears when `NODE_ENV=development` to avoid cluttering the production interface.

### Real-time Logging
- **API Calls**: All Microsoft Graph API requests are logged with timing
- **Errors**: Detailed error information including status codes and messages
- **User Actions**: File clicks, folder navigation, and search operations
- **Authentication**: Token status and refresh attempts

### Debug Information Displayed
- Current folder ID
- Authentication status
- Total number of logs
- Error count
- Recent errors with expandable details
- Complete log history (last 20 entries)

### Interactive Features
- **Expand/Collapse**: Click on log entries to see detailed information
- **Copy to Clipboard**: Copy error details for sharing or analysis
- **Clear Logs**: Reset the debug log history
- **Refresh Auth**: Force authentication refresh

## Enhanced Error Handling

### Microsoft Graph Service Improvements
- **Detailed Error Logging**: Captures HTTP status codes, error codes, and messages
- **Performance Tracking**: Measures API call duration
- **Enhanced Error Objects**: Includes additional context for debugging

### Component-Level Debugging
- **Operation Tracking**: Logs all user interactions and their outcomes
- **Error Context**: Provides file names, IDs, and operation details
- **Timing Information**: Tracks how long operations take

## How to Use the Debug Panel

### 1. Enable Development Mode
```bash
# Make sure you're running in development mode
NODE_ENV=development npm run dev
```

### 2. Access the Debug Panel
- Navigate to the OneDrive demo page
- The debug panel will appear at the top of the page
- Click the chevron icon to expand/collapse the panel

### 3. Reproduce the Issue
- Perform the actions that trigger the "item not found" error
- Watch the debug logs populate in real-time
- Note any error entries that appear

### 4. Analyze the Logs
- Look for error entries (red background)
- Click on error entries to expand details
- Check the timing of operations
- Look for patterns in failed requests

### 5. Common Debug Scenarios

#### Scenario 1: File Access Error
```json
{
  "type": "error",
  "operation": "Failed to read file content",
  "details": {
    "fileId": "01BYE5RZ...",
    "fileName": "document.txt",
    "error": "Microsoft Graph API error: Item not found"
  }
}
```
**Action**: Check if the file still exists in OneDrive web interface

#### Scenario 2: Authentication Error
```json
{
  "type": "error",
  "operation": "Failed to load files",
  "details": {
    "error": "Your Microsoft session has expired. Please sign in again."
  }
}
```
**Action**: Use the "Refresh Auth" button or reload the page

#### Scenario 3: Permission Error
```json
{
  "type": "error",
  "operation": "Failed to load files",
  "details": {
    "error": "Microsoft Graph API error: Access denied",
    "folderId": "01BYE5RZ..."
  }
}
```
**Action**: Check folder permissions in OneDrive

## Troubleshooting Steps

### Step 1: Check Authentication
1. Look for authentication errors in the debug panel
2. Verify the user is signed in with Microsoft
3. Try refreshing authentication using the debug panel button

### Step 2: Verify File/Folder Existence
1. Note the file ID from the error logs
2. Check if the file exists in OneDrive web interface
3. Try accessing the file directly in OneDrive

### Step 3: Check Permissions
1. Verify the user has access to the folder/file
2. Check if it's a shared folder with restricted access
3. Try accessing as the file owner

### Step 4: Monitor API Calls
1. Watch the debug logs for API call patterns
2. Look for failed requests and their error codes
3. Check if errors are consistent or intermittent

### Step 5: Test Different Scenarios
1. Try different files and folders
2. Test with different user accounts
3. Compare behavior between file types

## Production Considerations

### Logging in Production
- Debug panel is automatically hidden in production
- Server-side logging still captures errors
- Use application monitoring tools for production debugging

### Error Handling
- Users see friendly error messages
- Detailed errors are logged server-side
- Automatic retry mechanisms for transient errors

### Performance
- Debug logging has minimal performance impact
- Logs are limited to prevent memory issues
- Only essential information is captured in production

## Getting Help

If you continue to experience "item not found" errors:

1. **Collect Debug Information**:
   - Copy error details from the debug panel
   - Note the specific files/folders affected
   - Record the sequence of actions that trigger the error

2. **Check Microsoft Graph API Status**:
   - Visit the Microsoft 365 Service Health Dashboard
   - Look for known issues with OneDrive or Graph API

3. **Contact Support**:
   - Provide the debug information collected
   - Include screenshots of the debug panel
   - Describe the user's OneDrive setup and permissions

This debugging system should help identify the root cause of "item not found" errors and provide the information needed to resolve them effectively.
