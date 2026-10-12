Commit Instruction Template

Description

This command analyzes all file changes and creates grouped logical commits. All commit messages must follow the rules below. Important, each commit must not have a description that telling claude is doing the commit.

📝 Commit Rules
	- Each commit must contain only a single title, no description and no body, no description that telling claude is doing the commit.
	- The title must follow this pattern:

{ "Fix" | "Feature" | "Refactor" | "Chore" | "Docs" | "Style" }/{ "Admin" | "API" | "Web" | "Common" } - {Short description}

Examples:
	- Fix/API - Correct transaction validation
	- Feature/Web - Add new dashboard menu

🚫 Files to Exclude
	- Never commit: schema.prisma

If this file is detected in the changes, it must be ignored.

🔄 Commit Process

The assistant must:
	1.	Run git status.
	2.	Analyze all modified files.
	3.	Group files logically using logical batches.
	4.	Use only the required commit title format.
	5.	Ask the user for validation once all commits are prepared.
	6.	Only after validation, execute commits one by one with immediate push after each commit:
		•	For each commit:
			a. git add <files>
			b. git commit -m "title"
			c. git push immediately
			d. If push fails, log the error (see error handling below)
	7.	Continue with next commit regardless of previous failures.

⚠️ Error Handling (Biome / Code Rabbit)

If a commit or push fails:
	1.	Create/append to .claude/err/<filename1>,<filename2>
	2.	Log the exact error message in that file
	3.	The filename should list all files involved in the failed commit (comma-separated)
	4.	Continue with remaining commits
	5.	At the end, report all failures to the user

Example error file structure:
```
.claude/err/transaction.service.ts,transaction.controller.ts
```

Content example:
```
Commit: Fix/API - Correct transaction validation
Error: Biome formatting check failed
Details: [actual error output from git/biome]
Timestamp: 2025-01-14 10:30:45
```

Example Output Format (for user validation)

Before executing, output something like:

Planned commits:
1. Feature/API - Add transaction filter
   Files: src/api/transaction.service.ts, src/api/transaction.dto.ts
2. Fix/Web - Correct UI button alignment
   Files: src/web/components/Button.tsx
3. Chore/Common - Update ESLint config
   Files: .eslintrc.json

⚠️ Note: Each commit will be pushed immediately after creation.

Do you confirm these commits? (y/n)

If the user validates → execute commits with immediate push after each
If not → allow the user to modify titles or regroup.

Post-Execution Report

After all commits are processed, report:
	- ✅ Successfully pushed commits (list)
	- ❌ Failed commits (with reference to error files in .claude/err/)

🗣️ Language Rules
	- All assistant responses must be in English.
	- Commit titles must be in English.
	- Short descriptions should be concise, technical if needed.

⸻