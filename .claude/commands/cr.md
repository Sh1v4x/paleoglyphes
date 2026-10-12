Commit Instruction Template (Code Rabbit Fixes)

Description
This command analyzes all file changes and creates grouped logical commits.
All commit messages must follow the rules below.
Important: each commit must not have any description or wording indicating that Claude or the assistant is performing the commit.

📝 Commit Rules
- Each commit must contain only a single title (no body, no description).
- Each commit title must start with: CR - 
- The title must clearly describe what the Code Rabbit fix is correcting.
- Commit titles must be concise and technical when appropriate.

Examples:
- CR - Fix transaction validation logic in API
- CR - Correct button alignment in Web dashboard
- CR - Resolve ESLint rule conflicts in Common modules

🚫 Files to Exclude
- Never commit: schema.prisma
- If this file is detected in the changes, it must be ignored entirely.

🔄 Commit Process
The assistant must:
1. Run `git status`.
2. Analyze all modified files.
3. Ignore excluded files.
4. Group files logically into coherent batches based on the fixes applied.
5. Generate commit titles using only the required format:
   CR - {short description of the fix}
6. Prepare a list of planned commits and display them to the user for validation.
7. Do NOT push commits.
8. Wait for explicit user validation before proceeding.
9. After validation, output the exact commands needed to execute each commit manually:
    - git add <files>
    - git commit -m "CR - <title>"

⚠️ Error Handling (Biome / Code Rabbit)
If a commit fails when executed manually:
1. Create or append to the file:
   .claude/err/<filename1>,<filename2>
2. The filename must list all files involved in the failed commit (comma-separated).
3. Log the exact error message in that file using the following structure:

Commit: CR - <commit title>
Error: <error summary>
Details: <full error output from git / biome / code rabbit>
Timestamp: <YYYY-MM-DD HH:MM:SS>

4. Continue with remaining commits.
5. At the end, report all failures to the user.

📋 Example Output Format (for user validation)

Planned commits:
1. CR - Fix transaction validation logic in API
   Files: src/api/transaction.service.ts, src/api/transaction.dto.ts

2. CR - Correct UI button alignment in Web dashboard
   Files: src/web/components/Button.tsx

3. CR - Resolve ESLint configuration conflicts
   Files: .eslintrc.json

Do you confirm these commits? (y/n)

- If the user validates:
  - Output the git add and git commit commands for each commit.
- If the user does not validate:
  - Allow the user to rename commit titles or regroup files.

🗣️ Language Rules
- All assistant responses must be in English.
- All commit titles must be in English.
- Short descriptions must be clear, concise, and focused on the fix.