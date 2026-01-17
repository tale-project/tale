// Type declarations for react-file-icon
// These types cover only the API used by this project

declare module "react-file-icon" {
  export type DefaultExtensionType =
    | "3dm" | "3ds" | "3g2" | "3gp" | "7zip" | "aac" | "aep" | "ai" | "aif"
    | "aiff" | "asf" | "asp" | "aspx" | "avi" | "bin" | "bmp" | "c" | "cpp"
    | "cs" | "css" | "csv" | "cue" | "dat" | "dmg" | "doc" | "docx" | "dwg"
    | "dxf" | "eot" | "eps" | "exe" | "flac" | "flv" | "fnt" | "fodp" | "fods"
    | "fodt" | "fon" | "gif" | "gz" | "h" | "htm" | "html" | "indd" | "ini"
    | "java" | "jpeg" | "jpg" | "js" | "json" | "jsx" | "m4a" | "m4v" | "max"
    | "md" | "mid" | "mkv" | "mov" | "mp3" | "mp4" | "mpeg" | "mpg" | "obj"
    | "odp" | "ods" | "odt" | "ogg" | "otf" | "pdf" | "php" | "pkg" | "plist"
    | "png" | "ppt" | "pptx" | "pr" | "ps" | "psd" | "py" | "rar" | "rb"
    | "rm" | "rtf" | "scss" | "sitx" | "sql" | "svg" | "swf" | "sys" | "tar"
    | "tex" | "tif" | "tiff" | "ts" | "tsx" | "ttf" | "txt" | "wav" | "webm"
    | "wmv" | "woff" | "wpd" | "wps" | "xlr" | "xls" | "xlsx" | "xml" | "yml"
    | "zip" | "zipx";

  export interface FileIconProps {
    color?: string;
    extension?: string;
    fold?: boolean;
    foldColor?: string;
    glyphColor?: string;
    gradientColor?: string;
    gradientOpacity?: number;
    labelColor?: string;
    labelTextColor?: string;
    labelTextStyle?: object;
    labelUppercase?: boolean;
    radius?: number;
    type?: "3d" | "acrobat" | "audio" | "binary" | "code" | "code2" | "compressed"
      | "document" | "drive" | "font" | "image" | "presentation" | "settings"
      | "spreadsheet" | "vector" | "video";
  }

  export function FileIcon(props: FileIconProps): JSX.Element;

  export const defaultStyles: Record<DefaultExtensionType, FileIconProps>;
}
