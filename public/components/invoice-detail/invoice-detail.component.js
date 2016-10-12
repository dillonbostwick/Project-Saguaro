'use strict';

angular.
    module('invoiceDetail', ['ngInputModified', 'ui.bootstrap']).
    component('invoiceDetail', {
        templateUrl: 'components/invoice-detail/invoice-detail.template.html',
        controller: function InvoiceDetailController(api, $routeParams, $window, $filter, $scope) {
            var self = this;
            window.ctrl = self; // For debugging
            self.path = $window.location.hash

            // External requests:
            self.Vendors = api.Vendor.query();
            self.Hoods = api.Hood.query();
            self.Expenses = api.Expense.query();
            self.Hoas = api.Hoa.query();
            self.Activities = api.Activity.query();
            self.Users = api.User.query();
            self.CurrentUser = api.CurrentUser.get()

            //Used for adding new changes to Invoice.actions when it is being
            //edited:
            self.changeComments = [];
            self.generalComment = '';

            // Whether the invoice is new:
            self.isNew = $routeParams.id === 'new';
            self.enableAim = false;

            // Either Invoice is retrived from DB or it gets a starter template:
            self.Invoice = self.isNew
                ? new api.Invoice({
                    serviceDate: new Date,
                    _id: '',
                    _vendor: '',
                    lineItems: [],
                    comment: '',
                    actions: [{
                        desc: 'CREATED',
                        comment: '',
                        date: new Date,
                        _user: undefined // Wait for CurrentUser promise resolution to fill
                    }]
                })
                : api.Invoice.get({ id: $routeParams.id })

            ////////////////////////////////////////////////////////////////////
            //PROMISES

            /* Note: self.isNew can be processed on page load because $routeParams 
             * processes on page load. For self.canReview and self.canEdit, must
             * wait for the CurrentUser to be fetched from the api (via a server
             * round trip processing SID cookie). Note that the camelCased currentUser
             * is different from the PascalCased self.CurrentUser. The former is
             * the returned data from the promise, while the latter is used to
             * bind to the view (which obviously Angular knows when to update).
             */
            self.CurrentUser.$promise.then(function(currentUser) {
                // Whether is in the current user's queue:
                self.canReview = _.contains(currentUser._invoiceQueue, $routeParams.id);
                // Whether it can be edited at all:
                self.canEdit = self.isNew || self.canReview;
                // See self.Invoice declaration for this:
                if (self.isNew) {
                    self.Invoice.actions[0]._user = currentUser._id;
                }

                return currentUser;
            });

            //Set pristine after the invoice loads, so that AIM doesn't
            //recognize the invoice load from api is a Form change
            if (self.canReview) {
                self.Invoice.$promise.then(function(invoice) {
                    self.enableAim = true;
                    $scope.Form.$setPristine()
                });
            }

            self.datePickerOptions = {
                disabled: [],
                maxDate: new Date(3000, 1, 1),
                minDate: new Date(2000, 1, 1),
                startingDay: 1
            };
            
            self.foo = new Date();
            self.openDate = false;

            ////////////////////////////////////////////////////////////////////
            //CTRL METHODS

            //lineItem logic:

            /* Pushes a new lineItem to self.lineItems.
             * Note: it is a angular getter/setter, hence must check args
             */
            self.addLineItem = function() {
                self.Invoice.lineItems.push({
                    category: 'CIP', //default behavior is CIP
                    _hood: '',
                    subHood: '',
                    _activities: [],
                    _expense: '',
                    amount: undefined
                });
            }

            /* Given a lineItem, pushes an empty object literal to
             * the back of the _activities array of the lineItem
             */
            self.addActivity = function(lineItem) {
                lineItem._activities.push('')
            }

            /* getSubHoodOptions takes a lineItem and returns
             * the possible options that can be selected for ANOTHER subHood.
             */
            self.getSubHoodOptions = function(lineItem) {
                return lineItem._hood
                    ? self.getElementById(lineItem._hood, 'subHoodOptions', 'Hoods')
                    : [];
            }

            /* Given a subHood (dev, hood, or a number), determine which activities
             * can be applicable to that subHood. Follows Brightwater logic:
             * 0000-0399 = Dev
             * 0400-0999 = Hood
             * 1000-9999 = else
             *
             * lineItem is the line item and currentIndex is the the index of the
             * activity in lineItem._activities that is being changed - this is
             * so that it is persistent in the dropdown list when other currently
             * selected activities would otherwise get filtered out by the function
             */
            self.getActivityOptions = function(lineItem, currentIndex) {
                var activityOptions;

                switch(lineItem.subHood) {
                    case '':
                        activityOptions = [];
                    case 'Dev':
                        activityOptions = self.Activities.filter(function(activity) {
                            return   0 <= activity.code && 
                                   399 >= activity.code
                        });

                        break;
                    case 'Hood':
                        activityOptions = self.Activities.filter(function(activity) {
                            return 400 <= activity.code &&
                                   999 >= activity.code
                        });

                        break;
                    default: // i.e. is number so lots
                        activityOptions = self.Activities.filter(function(activity) {
                            return 1000 <= activity.code &&
                                   9999 >= activity.code
                        });
                }

                //Remove currently selected options EXCEPT for the currently
                //selected item itself
                // activityOptions = activityOptions.filter(function(option) {

                //     //option is not in activities unless it is current activity
                //     return $.inArray(option._id, lineItem._activities) === -1 ||
                //            option._id === lineItem._activities[currentIndex];
                // });

                // console.log(currentIndex, activityOptions.length);

                return activityOptions;
            }

            /* Given a lineItem, runs the JS native eval() function on the
             * lineItem's amount - in other words, if the amount is a string
             * including operators, it will evaluate the operators and convert
             * it to a Number. Also updates total amount upon change
             */
            self.evaluateAmount = function(lineItem) {
                lineItem.amount = $filter('currency')(eval(lineItem.amount), '');
                self.updateAmount();
            }

            /* Given an array activities, sorts the array alphabetically
             * according to the 'desc' property of each objet in the array.
             * returns the sorted array
             */
            self.sortByDesc = function(activities) {
                return activities.sort(function(a, b) {
                    if (a.desc < b.desc) { return -1; }
                    if (a.desc > b.desc) { return 1; }

                    return 0;
                });
            }

            /* To be ran every time an amount changes - updates Invoice.amount with
             * the correct amount, or sets to NaN if a view expression has not
             * been evaluated with eval()
             */
            self.updateAmount = function() {
                self.Invoice.amount = _.pluck(self.Invoice.lineItems, 'amount')
                .reduce(function(a, b) {
                    return Number(a) + Number(b);
                }, 0);
            }

            /* When a new invoice is submitted, many actions occur:
             * Gets pushed to the queues of pipeline receivers
             * If new, run submitNewInvoice which pushes it to Invoices
             * if existing, run submitExistingInvoice which:
             *   - Makes the changes pristine
             *   - Adds changes to Invoice.actions in proper format
             *   - Update the invoice in Invoiecs
             *
             * paramater:
             *   Boolean another: if false, returns to dashboard, otherwise,
             *   adds new invoices or loads next invoice in user queue
             */
            self.submit = function(another) {
                var _receivers = ['64374526']; //TODO: this needs logic

                pushInvoiceToReceivers(_receivers, self.Invoice._id, self.Users);

                self.isNew ? submitNewInvoice(self, another)
                           : submitExistingInvoice(self, another, false)
            }

            self.hold = function () {
                submitExistingInvoice(self, true, false);
            }

            self.deleteInvoice = function() {
                self.Invoice.$delete();

                $window.location.href = '/#!/dashboard';
            }

            ////////////////////////////////////////////////////////////////////
            //db getters

            /* Given an id and a collection, return the name of that document
             * 
             * Warning: this is reproduced elsewhere (as of writing, in user-dashboard).
             *  Consider moving to core!
             */
            self.getNameById = function(id, collection) {
                var doc = _.findWhere(self[collection], { _id: id })

                // If not found return null, otherwise return the name or
                // 'firstName lastName'
                return doc
                    ? doc.name
                    || [doc.firstName, doc.lastName].join(' ')
                    : null;
            }

            self.getElementById = function(id, element, collection) {
                var doc = _.findWhere(self[collection], { _id: id });

                return doc ? doc[element] : null;
            }

            ////////////////////////////////////////////////////////////////////
            //HELPER METHODS

            /* Given a list of receivers (array of ids),
             * one invoice (id)
             * and a list of all users in the model (array of ids)
             * each receiver gets the invoice pushed to the back of their
             * personal invoice queue.
             */
            function pushInvoiceToReceivers(_receivers, _invoice, _users) {
                var receiverModel;

                _.each(_receivers, function(_receiver) {
                    receiverModel = _.find(_users, function(user) {
                        return user._id === _receiver;
                    });

                    receiverModel._invoiceQueue.push(_invoice);
                    receiverModel.$update();
                });
            }

            function submitNewInvoice(self, another) {
                self.Invoice.$save(function() {
                    if (another) {
                        $window.location.reload();
                    } else {
                        $window.location.href = '/#!/dashboard'
                    }
                });
            }

            /* Parameters:
             *   self: $ctrl
             *   another: Boolean - add another vs go home
             *   hold: Boolean - whether to list action as "APPROVED" vs "HOLD"
             *
             * Description:
             *   Adds all modifiedModels to actions, sets pristine, adds a
             *   action (approved or hold), updates in database, redirects
             *   acording to another.
             */
            function submitExistingInvoice(self, another, hold) {
                //If changes were made, push them to the invoice history at
                //self.Invoice.actions
                //TODO: TEST!
                for (var i = 0; i < $scope.Form.modifiedModels.length; i++) {
                    self.Invoice.actions.push({
                        desc: 'CHANGED: ' + $scope.Form.modifiedModels[i].$name,
                        comment: self.changeComments[i],
                        date: new Date,
                        _user: self.CurrentUser._id
                    })
                }

                //Set to pristine - due to AIM nature, changes not confirmed
                $scope.Form.$setPristine()

                //Approval or hold action:
                self.Invoice.actions.push({
                    desc: hold ? 'HOLD' : 'APPROVED',
                    comment: self.generalComment,
                    date: new Date,
                    _user: self.CurrentUser._id
                })

                //TODO: needs testing
                self.Invoice.$update(function() {
                    if (another) {
                        //Stub - href next queue in user queue
                    } else {
                        $window.location.href = '/#!/dashboard'
                    }
                });






            }
        } // end controller
    }); // end component