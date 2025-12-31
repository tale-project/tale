'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  useCreateAutomationDraft,
  useUpdateAutomationStatus,
  useUpdateAutomation,
  useDeleteAutomation,
} from '../hooks';
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
import { DeleteDialog, FormDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { JsonInput } from '@/components/ui/json-input';
import { Badge } from '@/components/ui/badge';
import { Stack, HStack, Grid } from '@/components/ui/layout';
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
import { useT } from '@/lib/i18n';

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
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
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
  const createAutomation = useCreateAutomationDraft();
  const activateAutomation = useUpdateAutomationStatus();
  const deactivateAutomation = useUpdateAutomationStatus();
  const updateWorkflow = useUpdateAutomation();
  const deleteAutomation = useDeleteAutomation();

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
        title: t('toast.created'),
        variant: 'success',
      });

      setNewAutomationForm({
        name: '',
        description: '',
      });

      setSelectedWorkflow(wfDefinitionId);
    } catch (error) {
      toast({
        title: t('toast.createFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleActivateWorkflow = async (wfDefinitionId: string) => {
    if (!user?._id) {
      toast({
        title: t('toast.authRequired'),
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
        title: t('toast.activated'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('toast.activateFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleDeactivateAutomation = async (wfDefinitionId: string) => {
    if (!user?._id) {
      toast({
        title: t('toast.authRequired'),
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
        title: t('toast.deactivated'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('toast.deactivateFailed'),
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
        title: t('toast.authRequired'),
        variant: 'destructive',
      });
      return;
    }

    let parsedConfig: unknown = {};
    try {
      parsedConfig = editForm.config ? JSON.parse(editForm.config) : {};
    } catch {
      toast({
        title: tCommon('validation.invalidJson'),
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
      toast({ title: t('toast.updated'), variant: 'success' });
      setEditingId(null);
    } catch (error) {
      toast({
        title: t('toast.updateFailed'),
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
        title: t('toast.deleteFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <TabsContent value="templates" asChild>
      <Stack gap={4}>
      <Grid cols={1} lg={2} gap={6}>
        {/* Create New Automation (Dialog) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              {t('templates.newAutomation')}
            </CardTitle>
            <CardDescription>{t('templates.createNewTemplate')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              title={t('createDialog.title')}
              description={t('templates.fillDetails')}
              submitText={tCommon('actions.create')}
              submitDisabled={!newAutomationForm.name}
              onSubmit={async (e) => {
                e.preventDefault();
                await handleCreateAutomation();
                setCreateOpen(false);
              }}
              trigger={<Button className="w-full">{t('createButton')}</Button>}
            >
              <Input
                id="workflow-name"
                label={t('configuration.name')}
                value={newAutomationForm.name}
                onChange={(e) =>
                  setNewAutomationForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                placeholder={t('configuration.namePlaceholder')}
              />
              <Textarea
                id="automation-description"
                label={t('configuration.description')}
                value={newAutomationForm.description}
                onChange={(e) =>
                  setNewAutomationForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={t('configuration.descriptionPlaceholder')}
              />
            </FormDialog>
          </CardContent>
        </Card>

        {/* Automation List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <List className="size-4" />
              {t('templates.automationTemplates')}
            </CardTitle>
            <CardDescription>
              {t('templates.manageExisting')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {automations === undefined ? (
              <div className="text-center py-4">{t('templates.loading')}</div>
            ) : automations.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                {t('templates.noAutomationsFound')}
              </div>
            ) : (
              <Stack gap={3}>
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
                          <Stack
                            gap={2}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              label={t('configuration.name')}
                              value={editForm.name}
                              onChange={(e) =>
                                setEditForm((p) => ({
                                  ...p,
                                  name: e.target.value,
                                }))
                              }
                            />
                            <Textarea
                              label={t('configuration.description')}
                              value={editForm.description}
                              onChange={(e) =>
                                setEditForm((p) => ({
                                  ...p,
                                  description: e.target.value,
                                }))
                              }
                            />
                            <div>
                              <span className="text-base font-medium">
                                {t('templates.configJson')}
                              </span>
                              <hr className="mt-2 mb-4 border-border" />
                              <JsonInput
                                value={editForm.config}
                                onChange={(value) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    config: value,
                                  }))
                                }
                                rows={4}
                                description={t('templates.configDescription')}
                              />
                            </div>
                          </Stack>
                        ) : (
                          <>
                            <h4 className="font-medium">{workflow.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {workflow.description || t('templates.noDescription')}
                            </p>
                            <HStack gap={2} className="mt-2">
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
                            </HStack>
                          </>
                        )}
                      </div>
                      <HStack gap={1}>
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
                      </HStack>
                    </div>
                  </div>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>
      {/* Delete confirmation dialog */}
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('templates.deleteTitle')}
        description={t('templates.deleteDescription')}
        onDelete={async () => {
          if (!deleteTarget) return;
          await handleDeleteAutomation(deleteTarget);
          setDeleteOpen(false);
          setDeleteTarget(null);
        }}
      />
      </Stack>
    </TabsContent>
  );
}
