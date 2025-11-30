'use client';

import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Eye,
  Pencil,
  Trash2,
  Plus,
  Sparkles,
  MoreVertical,
} from 'lucide-react';
import { format } from 'date-fns';
import Pagination from '@/components/ui/pagination';

interface ExampleMessage {
  id: string;
  content: string;
  updatedAt: Date;
}

interface ExampleMessagesTableProps {
  examples: ExampleMessage[];
  onAddExample: () => void;
  onViewExample: (example: ExampleMessage) => void;
  onEditExample: (example: ExampleMessage) => void;
  onDeleteExample: (exampleId: string) => Promise<void>;
}

export default function ExampleMessagesTable({
  examples,
  onAddExample,
  onViewExample,
  onEditExample,
  onDeleteExample,
}: ExampleMessagesTableProps) {
  const searchParams = useSearchParams();
  const itemsPerPage = 5;

  // Get current page from URL query params, default to 1
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  const truncateMessage = (message: string, maxLength: number = 100) => {
    if (message.length <= maxLength) return message;
    return `"${message.substring(0, maxLength)}..."`;
  };

  // Calculate pagination
  const totalPages = Math.ceil(examples.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedExamples = examples.slice(startIndex, endIndex);
  const hasNextPage = currentPage < totalPages;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground tracking-[-0.096px]">
            Example messages
          </h3>
          <p className="text-sm text-muted-foreground tracking-[-0.084px]">
            Samples to guide the AI to match your tone and style.
          </p>
        </div>
        {examples.length > 0 && (
          <Button onClick={onAddExample}>
            <Plus className="size-4 mr-2" />
            Add example
          </Button>
        )}
      </div>

      {/* Table */}
      {examples.length === 0 ? (
        /* Empty State */
        <div className="flex items-center justify-center py-16 px-4 text-center bg-background border border-border rounded-lg">
          <div className="max-w-[24rem]">
            <div className="flex flex-col items-center">
              <Sparkles className="size-6 text-muted-foreground mb-5" />
              <h4 className="font-semibold text-foreground leading-tight mb-2">
                No examples yet
              </h4>
              <p className="text-sm text-muted-foreground mb-5">
                Add example messages to train the AI on your tone
              </p>
            </div>
            <Button onClick={onAddExample}>
              <Plus className="size-4 mr-2" />
              Add example
            </Button>
          </div>
        </div>
      ) : (
        <div className="ring-1 ring-border rounded-xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-medium">Message</TableHead>
                <TableHead className="font-medium w-[140px]">Updated</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedExamples.map((example) => (
                <TableRow key={example.id}>
                  <TableCell className="px-4">
                    <span className="text-sm font-medium text-foreground">
                      {truncateMessage(example.content)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground tracking-[-0.072px]">
                      {format(example.updatedAt, 'yyyy-MM-dd')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                          >
                            <MoreVertical className="size-4 text-muted-foreground" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => onViewExample(example)}
                          >
                            <Eye className="size-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onEditExample(example)}
                          >
                            <Pencil className="size-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDeleteExample(example.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {examples.length > itemsPerPage && (
        <Pagination
          currentPage={currentPage}
          total={examples.length}
          pageSize={itemsPerPage}
          totalPages={totalPages}
          hasNextPage={hasNextPage}
        />
      )}
    </div>
  );
}
