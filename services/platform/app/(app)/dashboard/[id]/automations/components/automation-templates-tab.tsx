'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import type { WorkflowConfig } from '@/convex/model/wf_definitions/types';
import { useAuth } from '@/hooks/use-convex-auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { JsonInput } from '@/components/ui/json-input';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import {
  Plus,
  List,
  Power,
  PowerOff,
  Edit3,
  Trash2,
  Save,
  X,
} from 'lucide-react';

interface AutomationTemplatesTabProps {
  organizationId: string;
  selectedWorkflow: string | null;
  setSelectedWorkflow: (id: string | null) => void;
}

export function AutomationTemplatesTab({
  organizationId,
  selectedWorkflow,
  setSelectedWorkflow,
}: AutomationTemplatesTabProps) {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [newAutomationForm, setNewAutomationForm] = useState({
    name: '',
    description: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    config: '{}',
  });

  // Queries
  const automations = useQuery(
    api.wf_definitions.listWorkflowsWithBestVersionPublic,
    {
      organizationId,
    },
  );

  // Mutations (only public APIs should be used from the client)
  const createAutomation = useMutation(
    api.wf_definitions.createWorkflowDraftPublic,
  );
  const activateAutomation = useMutation(
    api.wf_definitions.updateWorkflowStatusPublic,
  );
  const deactivateAutomation = useMutation(
    api.wf_definitions.updateWorkflowStatusPublic,
  );
  const updateWorkflow = useMutation(api.wf_definitions.updateWorkflowPublic);
  const deleteAutomation = useMutation(
    api.wf_definitions.deleteWorkflowPublic,
  );

  // Handlers
  const handleCreateAutomation = async () => {
    try {
      const wfDefinitionId = await createAutomation({
        organizationId,
        name: newAutomationForm.name,
        description: newAutomationForm.description,
        config: {},
        createdBy: 'user', // TODO: Replace with actual user ID when available
      });

      toast({
        title: 'Automation created successfully',
        variant: 'success',
      });

      setNewAutomationForm({
        name: '',
        description: '',
      });

      setSelectedWorkflow(wfDefinitionId);
    } catch (error) {
      toast({
        title: `Failed to create automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  const handleActivateWorkflow = async (wfDefinitionId: string) => {
    if (!user?._id) {
      toast({
        title: 'Authentication required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await activateAutomation({
        wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
        status: 'active',
        updatedBy: user._id,
      });
      toast({
        title: 'Automation activated successfully',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: `Failed to activate automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  const handleDeactivateAutomation = async (wfDefinitionId: string) => {
    if (!user?._id) {
      toast({
        title: 'Authentication required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await deactivateAutomation({
        wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
        status: 'inactive',
        updatedBy: user._id,
      });
      toast({
        title: 'Automation deactivated successfully',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: `Failed to deactivate automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  const startEditing = (
    workflow: Doc<'wfDefinitions'> & { config?: unknown },
  ) => {
    setEditingId(workflow._id);
    setEditForm({
      name: workflow.name,
      description: workflow.description || '',
      config: JSON.stringify(workflow?.config ?? {}, null, 2),
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = async (wfDefinitionId: string) => {
    if (!user?._id) {
      toast({
        title: 'Authentication required',
        variant: 'destructive',
      });
      return;
    }

    let parsedConfig: unknown = {};
    try {
      parsedConfig = editForm.config ? JSON.parse(editForm.config) : {};
    } catch {
      toast({
        title: 'Invalid JSON in config',
        variant: 'destructive',
      });
      return;
    }

    const configForUpdate = parsedConfig as WorkflowConfig;

    try {
      await updateWorkflow({
        wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
        updates: {
          name: editForm.name,
          description: editForm.description,
          config: configForUpdate,
        },
        updatedBy: user._id,
      });
      toast({ title: 'Automation updated successfully.', variant: 'success' });
      setEditingId(null);
    } catch (error) {
      toast({
        title: `Failed to update automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteAutomation = async (wfDefinitionId: string) => {
    try {
      await deleteAutomation({
        wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
      });
      if (selectedWorkflow === wfDefinitionId) setSelectedWorkflow(null);
    } catch (error) {
      toast({
        title: `Failed to delete automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  return (
    <TabsContent value="templates" className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create New Automation (Dialog) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              New Automation
            </CardTitle>
            <CardDescription>Create a new automation template</CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="w-full">Create automation</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create automation</DialogTitle>
                  <DialogDescription>
                    Fill in the details for your new workflow.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="workflow-name">Name</Label>
                    <Input
                      id="workflow-name"
                      value={newAutomationForm.name}
                      onChange={(e) =>
                        setNewAutomationForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="Enter automation name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="workflow-description">Description</Label>
                    <Textarea
                      id="automation-description"
                      value={newAutomationForm.description}
                      onChange={(e) =>
                        setNewAutomationForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      placeholder="Enter automation description"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={async () => {
                      await handleCreateAutomation();
                      setCreateOpen(false);
                    }}
                    disabled={!newAutomationForm.name}
                  >
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* Automation List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <List className="size-4" />
              Automation Templates
            </CardTitle>
            <CardDescription>
              Manage existing automation templates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {automations === undefined ? (
              <div className="text-center py-4">Loading automations...</div>
            ) : automations.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No automations found. Create your first automation above.
              </div>
            ) : (
              <div className="space-y-3">
                {automations.map((workflow) => (
                  <div
                    key={workflow._id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${selectedWorkflow === workflow._id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                      }`}
                    onClick={() => setSelectedWorkflow(workflow._id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        {editingId === workflow._id ? (
                          <div
                            className="space-y-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div>
                              <Label>Name</Label>
                              <Input
                                value={editForm.name}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    name: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <Label>Description</Label>
                              <Textarea
                                value={editForm.description}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    description: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <div>
                                <Label className="text-base font-medium">
                                  Config (JSON)
                                </Label>
                                <hr className="mt-2 mb-4 border-border" />
                              </div>
                              <JsonInput
                                value={editForm.config}
                                onChange={(value) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    config: value,
                                  }))
                                }
                                rows={4}
                                description="Automation configuration settings"
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <h4 className="font-medium">{workflow.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {workflow.description || 'No description'}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge
                                variant={
                                  workflow.status === 'active'
                                    ? 'green'
                                    : 'outline'
                                }
                                className="text-xs"
                              >
                                {workflow.status}
                              </Badge>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {editingId === workflow._id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEditing();
                              }}
                            >
                              <X className="size-4" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveEditing(workflow._id);
                              }}
                            >
                              <Save className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(
                                  workflow as Doc<'wfDefinitions'> & {
                                    config?: unknown;
                                  },
                                );
                              }}
                            >
                              <Edit3 className="size-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(workflow._id);
                                setDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                        {workflow.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeactivateAutomation(workflow._id);
                            }}
                          >
                            <PowerOff className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleActivateWorkflow(workflow._id);
                            }}
                          >
                            <Power className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete automation?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the
              automation template and its steps.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                await handleDeleteAutomation(deleteTarget);
                setDeleteOpen(false);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
