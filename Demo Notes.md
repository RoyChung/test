
### Demo 1
Slide location: Lab 3.1 - CER card
Env: my-cursor-project
File to use: example.py

Run 
Start the virtual machine
Python example.py

Steps: fix it 3 times with the red texts


### Demo 2
Slide location: Lab 3.2 - 3C card
Env: lab3
File to use: lesson4_data.zip

Task: you have a messy photo folder. You need to organise it and put it into one single folder.

problem 1: Wrong name from image
Beach.jpg (it's a dog)

Problem2: Same content, different names
IMG_001
photo1.jpg

Problem 3: Same name, different content
sunset.jpg

So, I used a simple prompt to work on the merge. (show flatten_photos.py)

“How exactly does it help me handle this? Does it deal with identical names, or does it handle identical photos?”

Show the result(check photos_flat folder). it has the filename deduplication, not content deduplication.

#### Solution
Create a 3C prompt.md (for those who don't know md file, just treat it as txt file)
Write down 
Context:
Components:
Criteria

1st attempt: just the criteria doable?

2nd attempt: Add images

3rd attempt: run the whole md file

Open the webpage and click accept.

3C prompt: 
`Context: I want to build a small tool that removes duplicates from the images in the /data folder. The deduplication should be based on file content, and then apply flattening (i.e., moving everything into the root directory of this folder).`

`Components: I want to keep a certain strategy here. If two files have the same filename but different content, I want it to automatically rename them for me—for example, by appending _1, _2, etc. to the end.`

`Criteria:  I’d like to have a webpage that shows which files will be merged, which files will be moved, and what the new filenames will be. This way I can clearly understand what’s going to happen. That’s what I want for the criteria. Ideally, I confirm everything before executing it—I’m not comfortable with it directly modifying things without review.

Is it doable? Please give me a look and don't organize the photo first.

Please also display both the to-keep and to-remove images.` 

### Demo 3
Slide location: p.48 - agentic AI
Env: lab 3


Example 1
Prompt
Create a chart for me that shows the stock prices of Google and Amazon over the past five years, from 2020 to 2025. Make sure the starting point is a trading day, and align the starting points of both stock prices so that it’s easier for me to compare them.

Here you can see the agent to work on many different stuff, but I don't care. I only care the chart.

Example 2
File to use: headshot.jpg

prompt 1
I have a file called headshot.jpg. I wish to apply a circle frame, and make circle oustide transparent.

prompt 2
The frame edge is still a bit rough, can you smoothen it?

Very profound changes.
In the past, we use GUI software like photoshop, now we can build code to solve the problems


Example 3

Prompt
I currently have an SQLite database called database.sqlite. I’d like to first explore it to understand the structure of the data inside, and then perform an in-depth data analysis for the past 20 years.




Lab 4 demo
env: Lab 4

create 
.cursor/rules create a file called rules.mdc
on the left panel

Write down new rule:  Always reply to me in French

Prompt 1
Tell me a joke

new rule: Every request, plan first, then execute

New chat prompt 2: 
From the beginning of 2024 until now, among Microsoft, Amazon, and Google, which stock has increased the most?


Rules: depth of thoughts and the effectiveness of the results, instead of giving a huge and comprehensive answers


*******

One more deeper example: learn from experiences

Not only read, but also write

We can allow agentic AI to evolve



New rule:
If you encounter any issues during execution, record the lessons learned in the rules.mdc file.

Prompt
From the beginning of 2024 until now, among Microsoft, Amazon, and Google, which stock has increased the most? You must use python


Can you make