# User guide

## Set up your workspace

The installer configures the setup key. The first owner chooses the workspace name, their display name, email and password. Afterwards, rename the workspace in **Profile & settings**. Staff use email/password login. There is no student login, public registration, OAuth, or email delivery service.

The owner can create administrators, instructors, and viewers in **User accounts**. New staff receive a generated temporary password shown once and must change it at first sign-in. Share credentials privately. Administrators can reset staff passwords; only the owner manages administrator roles. An administrator who also teaches needs the instructor role to own sessions.

## Courses, groups, and sessions

Create Courses first, then Groups. Group names must currently be unique across the installation: use `Python — Morning` and `Design — Morning` rather than two groups called `Morning`.

Add or import student names into a selected group. Assign each instructor to the appropriate Course + Group in **Assignments**. A session includes a course, group, instructor, date, optional times, room, and notes. Its roster snapshots the currently active students and starts with Absent marks. Later additions, group moves, and archival do not rewrite older rosters.

Instructors can view assigned groups and sessions they are allowed to access, including their own sessions. They can change attendance only for their own active sessions. Viewers can read the whole workspace; do not give viewer access to someone who should see only one group. Extra instructor capabilities should be granted sparingly.

## Excel viewer

Open **Excel viewer**, choose an `.xlsx` or `.xls` file, and switch worksheet tabs. The app shows values, dates/numbers, row/column headings, basic supported formatting, scrolling, and search in the current preview. Files are parsed in the browser. Opening a file does not import anything.

Formulas are not recalculated: only saved cell results can be displayed. Password-protected workbooks, macros, charts, complex styling, and Excel editing are not supported.

## Import students

1. Open **Import data** and choose student records.
2. Select an active Course and Group in the application.
3. Upload CSV, XLSX/XLS, or a PDF containing selectable table text.
4. For Excel, inspect the preview, select the desired worksheet, and continue to column mapping.
5. Map your name column to **Student Name**. Header text can differ because mapping is manual.
6. Inspect extracted rows. For PDF text, correct extraction errors before validating.
7. Choose **Validate and preview**, review missing names and possible duplicates, then confirm.

Minimal CSV:

```csv
Student Name
Morgan Chen
Sam Rivera
Taylor Singh
```

Course, Group, IDs, and unrelated file columns are ignored. Student records use internal keys; external student IDs are not required. Duplicate names are flagged within the selected group, including archived records. A possible duplicate is skipped by default; explicitly choose to import it as a separate person when appropriate.

CSV supports UTF-8, quoted commas, escaped quotes, comma/semicolon/tab delimiters. Scanned PDFs need OCR outside this application. No writes occur during file viewing, mapping, or validation. Confirmation sends the validated decisions, and the server checks them again. Invalid workbook files and oversized worksheet ranges produce errors; they are not silently truncated for import.

## Import attendance

Select attendance import and an existing session you can edit. Map **Student Name** and **Status**. Status must be Present or Absent (case-insensitive).

```csv
Student Name,Status
Morgan Chen,Present
Sam Rivera,Absent
Taylor Singh,Present
```

Names must match that session's roster after whitespace/case normalization. Missing, repeated, or ambiguous names are flagged and skipped. If two students have the same name in one roster, mark them individually instead of importing by name. Attendance imports update existing marks; they do not create students or sessions.

Changing the target, worksheet, or column mapping clears the previous validation. Always validate again before confirmation.

## Reports, archival, and recovery

Filter **Attendance & reports** by dates, course, group, instructor, status, room, and archived/active state. Export CSV or an XLSX workbook containing Attendance, Students, and Session Summary sheets. **Print / PDF** opens a report suitable for the browser's Save as PDF.

Archive records to stop new use while retaining history. Administrative deletion operations that support recovery create in-app snapshots, visible under **Backups**. Restoring a snapshot attempts to restore its supported records; inspect the result and audit log. Deletion of a student retains the saved name in historical attendance, including exports. Historical records with a removed student may need administrative recovery before their roster can be edited.

## Limits and non-goals

| Area | Current limit / behavior |
| --- | --- |
| File selection | 5 MB |
| Worksheet preview | First 2,000 rows and 50 columns; search covers displayed rows |
| Student import | 2,000 data rows + header, 50 columns; split larger worksheets |
| Attendance import/update | 500 students per request |
| PDF text import | 10 pages; no OCR |
| Session/group/student lists | Bounded lists; sessions/groups commonly capped at 500; use filters |
| Group history | Latest 500 active sessions, at most 50,000 marks; use filtered Reports for larger histories |
| Reports table | 1,000 rows per API page |
| Report export | Up to 20,000 marks; larger exports are refused so they cannot appear complete; narrow filters |
| Backups | Supported operation snapshots, not a disaster-recovery system |
| Organization model | One installation per organization; no cross-organization tenant isolation |

There is no native mobile app, public student portal, email invitations/reset emails, timetable integration, gradebook, biometric attendance, or offline synchronization. The interface is English; dates display with browser-local formatting, while import names use deterministic case/whitespace normalization and an English base-sensitivity sort.
