# \# Detection of Suspicious Nodes

# 

# It is a web-based tool for visual analysis and detection of suspicious nodes within a network. Users can upload a JSON dataset, interact with a force-directed graph, inspect node attributes, and classify nodes as suspicious.

# 

# \## Installation

# 1\. Clone project as:\\

# `git clone https://gitlab.gemma.feri.um.si/arien\_eu/graphs.git`

# 2\. Run `index.html`.

# 

# \## Usage

# \### 1. Choose Data

# Users can either choose from previously uploaded data or upload a new JSON file or URL containing node and relationship data.

# 

# \### 2. Create \& Train Model

# \- Select a predefined model from the dropdown.

# \- Edit and save default training parameters as a custom parameter set.

# \- Enter the label/attribute to train on (e.g., suspicious) and start the training process.

# \- Once training is complete, run predictions.

# \- After prediction is finished, click "Get Predictions" to view the results.

# 

# \### 3. Visualization

# This section displays a force-directed graph:

# \- Hovering over a node highlights all edges connected to that node.

# \- Clicking on a node opens a detail panel showing:

# &#x20;   - Node metadata

# &#x20;   - A "Mark as Suspicious" button to flag the node as suspicious.

# \- Flagged nodes are colored red in a graph.

# &#x20;   

# The "Suspicious" tab lists all flagged nodes. Clicking on a node ID expands detailed information.

# 

# \## Usage Cases

# \*\*USAGE CASE 1:\*\*

# Train a model and run prediction to automatically detect suspicious nodes.

# 

# \[Watch video](https://streamable.com/6dxk3z)

# 

# \*\*USAGE CASE 2:\*\* Manually mark suspicious nodes in the graph and export the modified JSON to train a model later.

# 

# \[Watch video](https://streamable.com/owak3m)

