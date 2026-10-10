import * as XLSX from 'xlsx';
import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync(new URL('../examples/',import.meta.url),{recursive:true});
const book=XLSX.utils.book_new();
const students=[['Student Name'],['Morgan Chen'],['Sam Rivera'],['Taylor Singh']];
const attendance=[['Student Name','Status'],['Morgan Chen','Present'],['Sam Rivera','Absent'],['Taylor Singh','Present']];
for(const [name,rows] of Object.entries({Students:students,Attendance:attendance,'Read me':[['Note'],['Synthetic examples. Select Course and Group in the application.']]})){
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=[{wch:32},{wch:20}];XLSX.utils.book_append_sheet(book,sheet,name);
}
writeFileSync(new URL('../examples/sample-workbook.xlsx',import.meta.url),XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
writeFileSync(new URL('../examples/students.csv',import.meta.url),XLSX.utils.sheet_to_csv(book.Sheets.Students)+'\n');
writeFileSync(new URL('../examples/attendance.csv',import.meta.url),XLSX.utils.sheet_to_csv(book.Sheets.Attendance)+'\n');
