import { desktopApi } from "../desktopApi";
import { rowsToFile, safeFileName, type DataRow, type ExportFormat } from "./adminTools";
export async function saveRows(rows:DataRow[],format:ExportFormat,base:string){const file=rowsToFile(rows,format);const name=`${safeFileName(base)}.${file.extension}`;return file.base64?desktopApi.saveBinaryFile(name,file.base64):desktopApi.saveTextFile(name,file.text||"");}
