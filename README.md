# OCPQ (Object-Centric Process Querying)
[__Download__](https://github.com/aarkue/ocpq/releases/latest)

See __[ocpq.aarkue.eu](https://ocpq.aarkue.eu)__ for more info and documentation!


## Installation
You can download the automatically cross-compiled installers for the latest release from [__github.com/aarkue/ocpq/releases/latest__](https://github.com/aarkue/ocpq/releases/latest).

The following installer formats are available:
- `[...].AppImage` for Linux (__Recommended for Linux__)
- `[...]-setup.exe` for Windows (__Recommended for Windows__)
- `[...].dmg` for macOS (__Recommended for macOS__)
- `[...].deb` for Linux (Debian)
- `[...].msi` for Windows
- `[...].app.tar.gz` for macOS

Note, that sometimes Windows Defender might erroneously detect a (false-positive) thread in the installers.
See also https://github.com/tauri-apps/tauri/issues/2486.
In this case, please either try a different installer variant (e.g., `.exe` instead of `.msi`) or use the alternative use Docker as described below. 

### Docker

Alternatively, you can also easily build and run the project locally using Docker.
This will start a local web server for the backend and the frontend.
Once the container is running, you can open [http://localhost:4567/](http://localhost:4567/) in your browser for the tool frontend.

#### Docker Compose
Run `docker compose up --build` in the project root.

Alternatively, the docker files can of the frontend and backend can also be used separately:

#### Docker Files

- __backend__:
  1. First build using `sudo docker build ./backend -t ocpq-backend`
  2. Then run with `docker run --init -p 3000:3000 ocpq-backend`
- __frontend__:
  1. First build using `sudo docker build ./frontend -t ocpq-frontend`
  2. Then run with `sudo docker run --init -p 4567:4567 ocpq-backend`


## Usage

### Loading OCELs
![image](https://github.com/user-attachments/assets/98210a69-cd3d-4c75-a2c5-0ee5f2e44d94)

In the following examples, we use the order management OCEL from https://zenodo.org/records/8428112.
JSON, XML, and SQLite OCEL 2.0 files are supported.

### Constraint Overview
![image](https://github.com/user-attachments/assets/1604911e-e06e-4099-bcb8-628d89b2a4bd)

### Constraint Editor
#### Adding Nodes
A new node can be added using the button on the top right of the editor.
![image](https://github.com/user-attachments/assets/a1d19f6a-2bf0-4a9d-85aa-f65db7e35f8c)

### Adding object and event variables
Inside the newly created node, object and event variables, as well as filter predicates can be added using the corresponding `+`-buttons inside the node.
In this example, we first create an object variable `o1` with the object type `orders`.
The variable name (1) and type (2) can be selected from a list of available values and the new variable added using the button (3).

![image](https://github.com/user-attachments/assets/05106376-8094-44d3-bc1a-0dc5dbd4c152)
![image](https://github.com/user-attachments/assets/336d7bd3-c986-4f4e-a714-c2af0696b3fe)

Similarly, we also add an event variable `e1` of type `confirm order`.

![image](https://github.com/user-attachments/assets/b7b5286e-3b65-4318-827b-91204964b4eb)
![image](https://github.com/user-attachments/assets/6f46c0f5-c9a4-4904-aadc-52c0afa32ea4)

The updated node then looks as shown below, indicating the added variables and their types.

![image](https://github.com/user-attachments/assets/268fefb5-1a55-4e43-9ac3-7c47e7317557)

### Adding Filter Predicates

Next, we want to add a predicate statement linking `o1` and `e1`.
For that, we add a new filter predicate using the `+`-button shown besides the filters.
Then, the filter type (_E2O: Event-To-Object Relationship_) can be selected (1), and the corresponding parameters (2), (3) and (4) can be configured.
Parameter (4) can optionally be used to only consider a specific relationship qualifier, but can also be left unspecified.

![image](https://github.com/user-attachments/assets/298c732c-8076-40a6-b872-1ce5c4d25fef)

Finally, using the _Add_ button (5) the filter predicate is added to the node, which then looks as shown below.

![image](https://github.com/user-attachments/assets/9ca87d3c-2bb9-47c7-b628-3352bba0fa71)

### Evaluating Queries and Constraints

Constructed constraints and queries can be evaluated using the play button at the top right (1).
After the evaluation finishes, the evaluation results are shown directly inside the editor at the corresponding nodes (2).
For instance, the query constructed so far yields 2000 results (i.e., 2000 output bindings).
As there are no constraint predicates for the node, no violation percentage is shown.


![image](https://github.com/user-attachments/assets/9f311c29-a872-4860-80a8-90df679372df)

### Adding Child Nodes

Next, we add a child node by first creating a new node (using the corresponding button on the top right) and then connect both nodes using the connection handles on the nodes (1) and (2).

![image](https://github.com/user-attachments/assets/14a714f5-920a-4e6a-aab1-147c2c7ebf92)

Clicking on the `-` button of the connection edge allows assigning a name to this edge. In this example, we name the edge `A`.
Additionally, we add an event variable and a filter predicate to this newly created node, such that it looks like shown below.

![image](https://github.com/user-attachments/assets/74070713-259c-4c69-b03f-3b582108a2c6)

### Adding Constraints

Using this added child node, we want to specify a constraint regarding the number of child bindings (i.e., the number of `pay order` events for the confirmed order `o1`).
This can be done by first clicking the `+` button next to the constraints of the _top_ / parent node and then selecting the _CBS: Child Bindings Set Size_ constraint type, and configuring the associated parameters (specifying the edge name `A` as well as the min and max count, both `1` in this example).

![image](https://github.com/user-attachments/assets/3d4687a8-0285-4770-9822-1a009ab9a532)



After adding this constraint and evaluating it (again using the play button on the top right), we can see that this constraint is satisfied for all bindings (i.e, a violation percentage of 0% is shown, and the node is colored in bright green).

![image](https://github.com/user-attachments/assets/c615ea0f-9227-436d-95d6-cb0c2e2c3ecc)


Finally, we want to make this constraint a little more interesting.
In particular, we want to specify that the `pay order` event should occur within 2 weeks after the `confirm order` event.
For this, we add a filter predicate to the child node, such that it only queries `pay order` events within this timeframe.

![image](https://github.com/user-attachments/assets/6c392c92-6a80-46ef-8363-69ff1a2f2433)

Evaluating this updated constraint again yields a violation percentage of 29.3%.

![image](https://github.com/user-attachments/assets/21e46af5-676c-4fc3-8b02-8f0a98ef9035)


An alternative way to model this constraint in this specific setting would be adding this time between event predicate as a constraint to the child node.
Note, that this constraint might be slightly different in general, as it simply requires that _all `pay order`_ events fulfill this constraint. 
In this case the constraint can also be modeled using just one node, as shown below.

![image](https://github.com/user-attachments/assets/d3753c87-a95f-4538-a001-b91fe791705b)

### Organizing and Saving Constraints
Each constraint can have a name and description, which can be modified using the inputs (1) and (2) when the constraint is selected.
Multiple constraints can be added an accessed using the list on the top right.
Note, that __by default constraint are not saved__ and will not be there after reloading or reopening the tool.
The constraints however can easily be saved locally by clicking on the save button on the top right of the tool.
Thus, __make sure to press the save button__ whenever you created or updated a constraint and want to save it.

![image](https://github.com/user-attachments/assets/62b0f291-2236-41f4-bddb-8089a342c5ab)


### Automatically Discovering Constraints
Constraints can also automatically be discovered using the `Auto-Discovery` button.
You can configure the different types of constraints to discover, as well as the object types for which to discover constraints.

The discovered Constraints are automatically added to the list of constraints and can be manually edited or deleted.

## Development

We use `cargo` and `pnpm`, so please ensure they are available by installing them (i.e., Rust and Node).
Then, install all dependencies (e.g., using `pnpm i` inside the `frontend` folder)

For the full-stack web application navigate to the `backend/web-server` folder and run `cargo run --release` to start the backend and navigate to the `frontend` folder and execute `pnpm run dev` to start the frontend. 
By default, the backend server is available at `http://localhost:3000` while the frontend is available at `http://localhost:5173/`.


For the desktop application, tauri (https://tauri.app/) is used.
To run the desktop application, simply run `pnpm run tauri dev -- --release` inside the `tauri` folder.


Currently, there are few unnecessary warning messages in the output when running or building the frontend with vite.
These are because we include an offline version of the monaco editor for easily writing CEL scripts.
Optionally, an online version of the editor can be used instead (by removing or updating `initEditorLoader` in `editor-loader.ts`), however then an internet connection is required for using the editor.


### Backend Context

As the tool supports multiple different backends (i.e., web server and tauri application), the exposed backend functionality is abstracted as a `BackendProvider`.
The typescript type `BackendProvider` in `frontend/src/BackendProviderContext.ts` specifies which functionality is available, and which parameters and return types are expected.
There are two implementations of that type: One for the web server backend (see `getAPIServerBackendProvider` in `frontend/src/BackendProviderContext.ts`), which makes fetch calls to the appropriate routes defined in `backend/web-server/src/main.rs` and another one for the tauri application backend (see `tauriBackend` in `tauri/src/main.tsx`), which calls the appropriate functions defined in `tauri/src-tauri/src/main.rs` via the invoke-method.
Throughout the frontend, the backend can be used via an backend context instance (which can be acquired using `const backend = useContext(BackendProviderContext);`) and then be used for calling functionality (e.g., `backend['function_name'](parameters,...)`).

To add new functionality, first define a new backend call fields in the `BackendProvider` type. Next, create the actual, shared implementation of the feature in the shared backend files (e.g., in `backend/shared/src/lib.rs`). Next, define the appropriate functions to call this shared functionality in the two backends (web server and tauri), and finally add the new backend call field to the two `BackendProvider` implementations (see above for where they are located.)
