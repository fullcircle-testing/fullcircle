import Html from '@kitajs/html';

import {Todo} from '../types/model';

export const renderRoot = () => {
    return (
        <html>
            <head>
                <script src='/example-app.js' defer></script>
            </head>
            <body>
                <button id='show-todos-button' type='button'>Show Todos</button>
                <div id='todos-container'></div>
            </body>
        </html>
    );
};

export const renderTodos = (todos: Todo[]) => {
    return (
        <div>
            {todos.map(t => (
                <div>
                    {t.title}
                </div>
            ))}
        </div>
    );
};

export const renderTodoForm = () => {

};
