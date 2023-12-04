/// <reference types="@kitajs/html/htmx.d.ts" />

import Html from '@kitajs/html';

import {Todo} from '../types/model';

export const renderRoot = () => {
    return (
        <html>
            <head>
                <script src="https://unpkg.com/htmx.org@1.9.9" integrity="sha384-QFjmbokDn2DjBjq+fM+8LUIVrAgqcNW2s0PjAxHETgRn9l4fvX31ZxDxvwQnyMOX" crossorigin="anonymous"></script>
            </head>
            <body>
                <button hx-get='/views/todos' hx-target='#todos-container'>Show Todos</button>
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
