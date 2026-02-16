export function ThinkingDots() {
  return (
    <div className="flex justify-start">
      <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
        <div className="flex space-x-1">
          <div className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </div>
    </div>
  );
}
